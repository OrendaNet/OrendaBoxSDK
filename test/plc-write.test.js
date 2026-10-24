const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeClient } = require('../lib');
const { validateManifest } = require('../lib/manifest');
test('scoped writes preserve delegation and request id over the authenticated facade', async () => {
  let request; const client = createRuntimeClient({ baseUrl: 'http://fixture/runtime', token: 'synthetic', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; } });
  await client.data.plcWrite([{ tag: 'setpoint', value: 10 }], { delegation: 'bounded', requestId: 'stable' });
  assert.equal(request.url, 'http://fixture/runtime/plc/write'); assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), { delegation: 'bounded', requestId: 'stable', writes: [{ tag: 'setpoint', value: 10 }] });
});
test('PLC commands require SDK 2 and explicit bounded data scopes', () => {
  const app = structuredClone(require('../templates/node-app/orenda-app.json')); const sdk = app.metadata.orenda;
  sdk.capabilities = ['plc:write']; sdk.sdkVersion = '1.2'; assert.ok(validateManifest(app).some(e => e.includes('SDK 2')));
  sdk.sdkVersion = '2'; assert.ok(validateManifest(app).length);
  sdk.scopes = { data: { machineIds: [], tagNames: [], deviceIds: [], harnesses: ['plc'], maxWindowSeconds: 3600, maxRows: 100, maxBytes: 65536 } };
  assert.deepEqual(validateManifest(app), []);
});
