# USB, networking and local display

Declare only the permissions your app needs in `metadata.orenda.capabilities`, then submit the release for review. The Box administrator grants permissions during installation or update and selects any USB devices. Runtime credentials, device paths and administrator permissions never belong in browser JavaScript.

```js
const { createRuntimeClient } = require('./sdk');
const box = createRuntimeClient();
const context = await box.context();
const granted = new Set(context.capabilities);
```

The manifest is a permission request. `context.capabilities` is the effective grant. A feature can be declined without granting the app a different route to the same resource. Explain unavailable features, preserve entered data, and avoid repeated automatic permission prompts.

## USB cameras

Use SDK `1.1`, Edge Manager `0.2.39+` and Platform `0.2.46+` for camera apps. Set the app manifest's `metadata.orenda.sdkVersion` to `"1.1"`, request only `usb:read`, and declare `minPlatformVersion: "0.2.46"` on the new release. The Box administrator must select the camera and approve read access. Camera video is a separate interface from the camera's microphone; audio is not captured.

`box.usb.devices()` returns only granted devices. Filter for `type === 'camera'`; device ids remain stable when Linux renumbers `/dev/videoN`. A camera without a serial number is tied to its physical USB port. Moving it to another port requires a fresh selection. Never ask the user to type a host device path.

Inside an app-server endpoint already authenticated with `requireEdgeUser`, forward the stream:

```js
const { Readable } = require('node:stream');
const cancellation = new AbortController();
res.once('close', () => cancellation.abort());
const { body, contentType } = await box.usb.cameraStream(selectedCameraId, {
  width: 640, height: 480, fps: 10, signal: cancellation.signal
});
res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
Readable.fromWeb(body).on('error', () => res.destroy()).pipe(res);
```

Display that authenticated endpoint with an ordinary `<img src="api/camera/stream">`. Catch startup errors before sending headers and show a retry/setup state. `services.usb.camera` in `box.context()` identifies the camera API; `services.usb.read` reports the capability grant. Keep tokens on the app server. Multiple browser viewers should share one upstream capture and disconnect slow viewers instead of accumulating frames.

The broker supports USB V4L2 single-planar MJPEG capture at `320x240`, `640x480` or `1280x720`, with output limited to `1..15` frames per second; defaults are `640x480` and `10` fps. The camera must accept the chosen MJPEG resolution. Unsupported modes return `422`, a busy camera returns `409`, and unplugged hardware returns `503`. There is at most one capture per device and two captures per Box, shared across all apps. Edge `0.2.41+` allows one app to use both slots and reports `services.usb.maxConcurrentCameraStreams: 2` in `box.context()`; assume one stream per app when the field is absent. This limit does not reserve slots: handle `429` if another app is using the remaining Box capacity, and allow a stopped helper to finish cleanup before retrying. Share each camera's single upstream capture among its browser viewers. Each camera buffer is bounded to 2 MiB. Client cancellation or removal of a selected-device read grant stops the affected capture; revoking the app token stops all its captures. Frames already delivered to an app cannot be recalled.

The host owns capture using the existing Python 3 runtime and a checked, inherited descriptor. Apps receive JPEG bytes; no camera pathname, privileged container, camera driver ioctl, audio interface, recording service, FFmpeg dependency or additional daemon is exposed. Compatibility with a specific physical camera still requires testing its negotiated format and unplug/reconnect behavior on the Box.

## Barcode scanners

A USB scanner in keyboard mode sends keystrokes to the focused input. For an operator using the app in a browser, start with an ordinary labelled input and a submit handler:

```html
<form id="scan-form">
  <label for="barcode">Scan a barcode</label>
  <input id="barcode" name="barcode" autocomplete="off" required>
  <button type="submit">Find item</button>
</form>
<script>
  document.querySelector('#scan-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.querySelector('#barcode');
    const response = await fetch('api/barcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: input.value.trim() })
    });
    if (response.ok) input.value = '';
  });
</script>
```

Configure the scanner's keyboard layout and Enter terminator to match the operator's setup. Keep focus visible and let users type a code when scanning is unavailable. This route uses normal keyboard input in the displayed app; it does not grant background access to every keyboard on the Box. Keyboard mode and serial mode are distinct device configurations; consult the scanner's documentation.

For a scanner attached to the Box whose bytes must be read by the app server, request `usb:read`. The administrator selects its device and read access during installation. Discover the granted devices:

```js
const { devices } = await box.usb.devices();
const readers = devices.filter(device => device.read);
// Show these names in your app's settings and save the user's chosen opaque id.
// Do not assume the first device is a scanner or copy a /dev path into the app.
```

Read a selected device in bounded batches:

```js
const sample = await box.usb.read(selectedDeviceId, {
  maxBytes: 256,
  timeoutMs: 5000
});
const bytes = Buffer.from(sample.dataBase64, 'base64');
```

For a USB serial scanner configured to emit UTF-8 text, collect these bytes until the scanner's documented line terminator arrives, then process one barcode. Preserve incomplete records between reads, impose a maximum barcode length, and handle `bytes: 0` as no new data. HID raw devices return HID reports, not UTF-8 text; use a parser for that scanner's report format. The optional `sample.reports` array contains each complete report in base64, while `dataBase64` contains their concatenated bytes. Do not treat arbitrary binary reports as text.

Edge retains the read descriptor between requests so HID reports arriving while your app processes a batch are not discarded. Readers expire after 15 seconds idle or when access is revoked. A read coalesces a burst until 40 ms idle, the requested byte limit, or its timeout. Choose a byte limit large enough for a complete HID report (maximum 4096 bytes). Use the five-second wait when idle and respect the runtime's 120-request-per-minute budget instead of continuously polling with short timeouts.

The initial broker supports selected `hidraw`, `ttyUSB`, `ttyACM`, and USB printer character devices. It does not expose all `/dev/input` events, raw libusb, storage devices, or the entire USB bus. Serial baud rates are configured by the administrator on the selected grant. Unplugged or unsupported hardware should produce a visible retry/setup state. Physical scanner compatibility depends on its Linux interface and report format.

## USB printers

Request `usb:write` and ask the administrator to select the intended USB printer. The app receives an opaque device id, not a host path. Encode output for that printer's documented language:

```js
const { devices } = await box.usb.devices();
const printers = devices.filter(device => device.write);
// Select the intended printer by its displayed name and save its opaque id.

// Example only for printers documented to support ESC/POS and this encoding.
const receipt = Buffer.concat([
  Buffer.from([0x1b, 0x40]),
  Buffer.from('Order 123\nThank you\n\n', 'ascii')
]);
const { bytes } = await box.usb.write(selectedPrinterId, receipt);
```

`usb.write` accepts a `Buffer` or `Uint8Array` of 1–65,536 bytes and returns the number of bytes written. A successful write means the device accepted bytes; it does not prove paper output. Handle offline/paper/error states according to the printer's protocol, and make retries explicit to avoid duplicate receipts. Request read access only if the supported printer interface needs status reads. This API does not install printer drivers or configure global print queues.

## Internet and LAN connections

Add `network:outbound` when the app needs an external HTTPS API or a network peripheral. Explain the destination and purpose in your app description. At installation the administrator can grant outbound Internet/LAN access; otherwise the app's network stays isolated from those destinations. Keep credentials for external systems in the app's own protected configuration.

```js
if (!granted.has('network:outbound')) {
  // Show: "Cloud sync is disabled. An administrator can approve network access."
} else {
  const response = await fetch('https://api.example.com/status', {
    signal: AbortSignal.timeout(5000),
    redirect: 'error'
  });
}
```

Use normal Node.js networking with timeouts after consent. A network printer uses its vendor's documented protocol over the granted LAN connection. Core PLC, Prometheus and MongoDB APIs remain available through the runtime client with their own grants and do not require outbound networking. The Box continues to protect its host services even when outbound access is granted.

## Run a WiFi hotspot

Use SDK `1.2`, Edge Manager `0.2.45+` and Platform `0.2.53+` for hotspot apps. Set `metadata.orenda.sdkVersion` to `"1.2"`, request only `hotspot:manage`, and declare `minPlatformVersion: "0.2.53"` on the new release. The Box administrator approves the grant at installation or update.

```js
const status = await box.hotspot.status();
const configured = await box.hotspot.configure({
  ssid: 'OrendaBox Line 4',
  password: 'shift-handover-2026',
  internetAccess: false
});
if (!configured.active) await box.hotspot.start();
// Nearby devices join the WiFi network and open configured.portalUrl,
// for example http://10.42.0.1/, to reach Box-hosted web apps.
```

The Box owns the access point through NetworkManager. It chooses a WiFi adapter that is not the active uplink, creates the AP profile, runs DHCP/DNS, and decides forwarding. `internetAccess: true` shares the Box uplink through NetworkManager shared mode; `false` keeps DHCP and Box-hosted web apps reachable while dropping forwarded traffic. If the only WiFi adapter is the uplink, start fails with a clear error — use Ethernet as the uplink for hotspot deployments. The stored password is write-only: `status()` never returns it, and `configure()` with an empty password keeps the current one. Apps never receive interface names, host paths, iptables rules, or the ability to run host commands.

## Show an app on the Box's HDMI display

For a user-facing app, set `ui.enabled: true` and request `display:present`. After consent, the administrator can select the app for the Box's local display. Render the same responsive HTML UI used in Edge Console. Use relative assets/API URLs and support touch, keyboard, visible focus and the intended display resolution.

The Box owns the compositor and viewer. It opens only the selected app's authenticated, scoped Edge UI session. The app does not receive a DRM/framebuffer device, compositor socket, browser administrator token or permission to replace another app's display. Background apps should not request this grant. Changing the selected display is an administrator action.

The existing opaque-origin sandbox still applies: no localStorage, cookies, IndexedDB, service workers, popups or embedded frames. Persist preferences through your authenticated server API. Device access uses the server-side USB client; browser USB/device permission prompts are not part of this flow. Keep essential operations available when hardware is disconnected and show a clear connection state instead of a blank screen.
