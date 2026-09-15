const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeClient } = require('../lib');
const { validateManifest } = require('../lib/manifest');

test('camera client streams bytes with server-only credentials and external cancellation', async () => {
  const id = 'usb-' + 'a'.repeat(32);
  const abort = new AbortController();
  let captured;
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const client = createRuntimeClient({ baseUrl: 'http://fixture/runtime', token: 'fixture-secret', fetchImpl: async (url, options) => {
    captured = { url, options };
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), { headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=orenda-camera' } });
  } });
  const result = await client.usb.cameraStream(id, { signal: abort.signal });
  assert.equal(captured.url, `http://fixture/runtime/usb/devices/${id}/camera/stream?width=640&height=480&fps=10`);
  assert.equal(captured.options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(captured.options.redirect, 'error');
  assert.deepEqual((await result.body.getReader().read()).value, bytes);
  assert.equal(captured.options.signal.aborted, false);
  abort.abort(); assert.equal(captured.options.signal.aborted, true);
  for (const options of [{ width: 1920, height: 1080 }, { fps: 16 }, { fps: true }, { devicePath: '/dev/video0' }]) assert.throws(() => client.usb.cameraStream(id, options));
  assert.throws(() => client.usb.cameraStream('/dev/video0'), /device id/);
});

test('camera client surfaces declined grants and rejects a non-stream response', async () => {
  const id = 'usb-' + 'a'.repeat(32);
  const create = response => createRuntimeClient({ baseUrl: 'http://fixture/runtime', token: 'fixture', fetchImpl: async () => response });
  await assert.rejects(create(new Response(JSON.stringify({ error: 'Select and approve this camera' }), { status: 403 })).usb.cameraStream(id), error => error.status === 403 && /approve/.test(error.message));
  await assert.rejects(create(new Response('unexpected')).usb.cameraStream(id), /invalid camera stream/);
});

test('SDK1.1 is accepted without changing existing SDK1 manifests', () => {
  const manifest = structuredClone(require('../templates/node-app/orenda-app.json'));
  for (const version of ['1', '1.1']) { manifest.metadata.orenda.sdkVersion = version; assert.deepEqual(validateManifest(manifest), []); }
  manifest.metadata.orenda.sdkVersion = '2';
  assert.ok(validateManifest(manifest).some(error => error.includes('sdkVersion')));
});
