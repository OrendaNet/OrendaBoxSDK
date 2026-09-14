const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { authenticateEdgeRequest, createRuntimeClient } = require('../lib');
const { validateManifest, CAPABILITIES } = require('../lib/manifest');

test('identity requires the app proxy secret and never trusts browser roles alone', () => {
  const headers = { 'x-orenda-auth-source': 'org-config', 'x-orenda-username': 'sam', 'x-orenda-user-roles': 'viewer' };
  assert.equal(authenticateEdgeRequest(headers, ''), null);
  assert.equal(authenticateEdgeRequest(headers, 'test-secret'), null);
  headers['x-orenda-edge-proxy-secret'] = 'test-secret';
  assert.deepEqual(authenticateEdgeRequest(headers, 'test-secret').roles, ['viewer']);
  assert.equal(authenticateEdgeRequest(headers, 'other-secret'), null);
  headers['x-orenda-edge-proxy-secret'] = ['test-secret', 'test-secret'];
  assert.equal(authenticateEdgeRequest(headers, 'test-secret'), null);
});

test('runtime client uses bearer auth server-side and fails closed on redirects and denied capabilities', async () => {
  let captured;
  const client = createRuntimeClient({ baseUrl: 'http://fixture/api/v1/runtime', token: 'synthetic', fetchImpl: async (url, options) => {
    captured = { url, options }; return { ok: false, status: 403 };
  } });
  await assert.rejects(client.readPlcTags(['temperature']), (error) => error.status === 403);
  assert.equal(captured.url, 'http://fixture/api/v1/runtime/plc/read');
  assert.equal(captured.options.headers.Authorization, 'Bearer synthetic');
  assert.equal(captured.options.redirect, 'error');
  assert.deepEqual(JSON.parse(captured.options.body), { tags: ['temperature'] });
});

test('release validation requires an ARM64 pinned artifact and safe capabilities', () => {
  const manifest = require('../templates/node-app/orenda-app.json');
  assert.deepEqual(validateManifest(manifest), []);
  assert.ok(validateManifest(manifest, { release: true }).length);
  const ready = { ...manifest, versions: [{ version: '1.0.0', minPlatformVersion: '0.2.45', architectures: ['arm64'], image: 'registry.example/app@sha256:' + 'a'.repeat(64) }] };
  assert.deepEqual(validateManifest(ready, { release: true }), []);
  assert.ok(validateManifest({ ...ready, versions: [{ ...ready.versions[0], digest: 'sha256:' + 'b'.repeat(64) }] }, { release: true }).length);
  assert.ok(validateManifest({ ...ready, versions: [{ ...ready.versions[0], architectures: ['arm64', 'mips'] }] }, { release: true }).length);
  assert.ok(validateManifest({ ...ready, metadata: { orenda: { ...manifest.metadata.orenda, healthPath: '//health' } } }).length);
  assert.ok(validateManifest({ ...ready, metadata: { orenda: { ...manifest.metadata.orenda, capabilities: ['admin'] } } }).length);
});

test('Mongo and metrics helpers expose easy scoped operations without database credentials', async () => {
  const calls = [];
  const client = createRuntimeClient({ baseUrl: 'http://fixture/runtime', token: 'app-credential', fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  const notes = client.mongo.collection('notes');
  await notes.insertOne({ title: 'Hello' });
  await notes.find({ status: 'open' }, { limit: 10 });
  await notes.replaceOne('document-id', { title: 'Updated' });
  await notes.deleteOne('document-id');
  await client.metrics.query('up');
  await client.metrics.queryRange('up', { start: 1, end: 61, step: 10 });
  await client.metrics.metricNames('plc_');
  assert.equal(calls[0].url, 'http://fixture/runtime/mongodb/collections/notes/documents');
  assert.deepEqual(calls[1].body, { filter: { status: 'open' }, limit: 10 });
  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[3].method, 'DELETE');
  assert.equal(calls[3].body, null);
  assert.deepEqual(calls[5].body, { query: 'up', start: 1, end: 61, step: 10 });
  assert.match(calls[6].url, /metrics\?prefix=plc_$/);
  assert.throws(() => client.mongo.collection('system.users'), /Invalid/);
});

test('USB helpers use selected opaque device ids and preserve binary data with bounded requests', async () => {
  const calls = [];
  const client = createRuntimeClient({ baseUrl: 'http://fixture/runtime', token: 'app-credential', fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => ({ bytes: 2 }) };
  } });
  const id = 'usb-' + 'a'.repeat(32);
  await client.usb.devices();
  await client.usb.read(id, { maxBytes: 64, timeoutMs: 2500 });
  const buffer = Uint8Array.from([0xff, 0x1b, 0x40, 0xee]);
  await client.usb.write(id, buffer.subarray(1, 3));
  await client.usb.write(id, Buffer.from([0, 255]));
  assert.equal(calls[0].url, 'http://fixture/runtime/usb/devices');
  assert.deepEqual(calls[1].body, { maxBytes: 64, timeoutMs: 2500 });
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(Buffer.from(calls[2].body.dataBase64, 'base64'), Buffer.from([0x1b, 0x40]));
  assert.deepEqual(Buffer.from(calls[3].body.dataBase64, 'base64'), Buffer.from([0, 255]));
  for (const id of ['/dev/ttyUSB0', '../other-app', '']) assert.throws(() => client.usb.read(id), /device id/);
  for (const options of [{ maxBytes: 4097 }, { maxBytes: 0 }, { timeoutMs: 5001 }, { timeoutMs: true }]) assert.throws(() => client.usb.read('usb-' + 'a'.repeat(32), options), /reads require/);
  for (const bytes of ['printer text', new Uint8Array(0), new Uint8Array(65537)]) assert.throws(() => client.usb.write(id, bytes), /writes require/);
  assert.equal(calls.length, 4, 'Invalid device paths and payloads never leave the app');
});

test('manifest permits the nine reviewed capabilities and keeps the starter network and hardware permissions minimal', () => {
  const starter = structuredClone(require('../templates/node-app/orenda-app.json'));
  assert.equal(CAPABILITIES.length, 9);
  assert.ok(!starter.metadata.orenda.capabilities.some((capability) => ['network:outbound', 'display:present', 'usb:read', 'usb:write'].includes(capability)));
  starter.metadata.orenda.capabilities = [...CAPABILITIES];
  assert.deepEqual(validateManifest(starter), []);
  starter.metadata.orenda.capabilities.push('usb:raw');
  assert.ok(validateManifest(starter).some((error) => error.startsWith('capabilities')));
});

test('scaffold produces a dependency-free app with working health and authenticated session', async (t) => {
  const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orenda-sdk-test-')), 'app');
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/orenda-box-sdk.js'), 'create', destination], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const again = spawnSync(process.execPath, [path.join(__dirname, '../bin/orenda-box-sdk.js'), 'create', destination], { encoding: 'utf8', windowsHide: true });
  assert.equal(again.status, 1);
  const port = 32181;
  const child = spawn(process.execPath, ['server.js'], { cwd: destination, windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ORENDA_EDGE_APP_PROXY_SECRET: 'fixture-secret' }, stdio: 'ignore' });
  t.after(() => child.kill());
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(origin + '/health')).ok) break; } catch (_) { /* Startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(origin + '/health')).status, 200);
  assert.equal((await fetch(origin + '/api/session')).status, 401);
  const response = await fetch(origin + '/api/session', { headers: { 'x-orenda-edge-proxy-secret': 'fixture-secret', 'x-orenda-auth-source': 'org-config', 'x-orenda-username': 'sam', 'x-orenda-user-roles': 'viewer' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, 'sam');
});
