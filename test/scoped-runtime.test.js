const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyServiceInvocation, createRuntimeClient } = require('../lib');
const { validateManifest } = require('../lib/manifest');
test('SDK 2 release requires the Platform version that packages its first-party credentials and runtime', () => {
  const manifest = structuredClone(require('../templates/node-app/orenda-app.json'));
  Object.assign(manifest.metadata.orenda, { sdkVersion: '2', capabilities: [], scopes: {}, workers: [] });
  manifest.versions = [{ version: '1.0.0', minPlatformVersion: '0.2.66', architectures: ['arm64'], image: 'registry.example/app@sha256:' + 'a'.repeat(64) }];
  assert.ok(validateManifest(manifest, { release: true }).some((error) => error.includes('at least 0.2.67')));
  manifest.versions[0].minPlatformVersion = '0.2.67';
  assert.deepEqual(validateManifest(manifest, { release: true }), []);
});
test('service identity validates audience, raw body binding and expiry', () => {
  const secret = 'a'.repeat(64); const now = Date.now(); const rawBody = Buffer.from('{"a":1}');
  const ctx = Buffer.from(JSON.stringify({ sourceAppId: 'orenda-mes', targetAppId: 'orenda-ai-agent', operation: 'jobs.create', actorId: 'user', orgAddress: '0x' + 'b'.repeat(40), machineIds: ['m1'], expiresAt: now + 30000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(['POST', '/v1/jobs', ctx, crypto.createHash('sha256').update(rawBody).digest('hex')].join('\n')).digest('hex');
  const req = { method: 'POST', originalUrl: '/v1/jobs', rawBody, headers: { 'x-orenda-service-token': secret, 'x-orenda-service-context': ctx, 'x-orenda-service-signature': signature } };
  const options = { secret, appId: 'orenda-ai-agent', now };
  assert.equal(verifyServiceInvocation(req, options).actorId, 'user');
  assert.equal(verifyServiceInvocation({ ...req, rawBody: Buffer.from('{"a":2}') }, options), null);
  assert.equal(verifyServiceInvocation(req, { ...options, appId: 'other' }), null);
  assert.equal(verifyServiceInvocation(req, { ...options, now: now + 40000 }), null);
  assert.equal(verifyServiceInvocation({ ...req, rawBody: undefined }, options), null);
});
test('runtime client uses only typed app and inference routes with opaque delegation', async () => {
  const calls = [];
  const client = createRuntimeClient({ baseUrl: 'http://host/api/v1/runtime', token: 'fixture', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; } });
  await client.invokeApp('orenda-mes', 'context.read', { machineIds: ['m1'] }, 'opaque');
  await client.inference.status('request1', { delegation: 'opaque' });
  assert.equal(calls[0].url, 'http://host/api/v1/runtime/apps/orenda-mes/invoke');
  assert.equal(JSON.parse(calls[0].options.body).delegation, 'opaque');
  assert.equal(calls[1].options.method, 'POST');
  assert.throws(() => client.invokeApp('../host', 'x', {}, 'opaque'), /Invalid/);
});
