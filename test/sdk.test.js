const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { authenticateEdgeRequest, createRuntimeClient } = require('../lib');
const { validateManifest } = require('../lib/manifest');

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
  assert.ok(validateManifest({ ...ready, metadata: { orenda: { ...manifest.metadata.orenda, capabilities: ['admin'] } } }).length);
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
