# OrendaBox SDK

Build an app, use the Box services you need, and distribute reviewed releases through [Orenda Apps](https://apps.orendanet.com). The SDK includes a working Node.js starter, a localhost development proxy, a manifest validator, and small server-side authentication and service clients. There are no npm runtime dependencies.

## Start in five minutes

Install Node.js 20 or newer, then:

```sh
git clone https://github.com/OrendaNet/OrendaBoxSDK.git
cd OrendaBoxSDK
node bin/orenda-box-sdk.js create ../my-box-app
cd ../my-box-app
npm run dev
```

Open `http://127.0.0.1:3100`. You are signed in as a local developer through an explicit development proxy. The app itself still checks proxy authentication. Edit `server.js` and `public/index.html`, restart the development command, and refresh. This starter uses relative URLs so it works inside the Edge Console app proxy.

The connection button calls the Box runtime API. On a laptop it explains that the app must be installed on a Box; it does not pretend that PLC or Box services are present. Never use the development proxy as a production service.

## Build an ARM64 release

The image must run as UID/GID `1000:1000`, store durable files in `/data`, and listen on `HOST`/`PORT`. The starter already follows these rules.

```sh
# From the generated app directory; sign in to your own registry first.
docker buildx build --platform linux/arm64,linux/amd64 \
  -t ghcr.io/YOUR-ACCOUNT/my-box-app:0.1.0 --push .
docker buildx imagetools inspect ghcr.io/YOUR-ACCOUNT/my-box-app:0.1.0
```

Copy the published manifest digest into a version entry in `orenda-app.json`:

```json
{
  "version": "0.1.0",
  "minPlatformVersion": "0.2.45",
  "image": "ghcr.io/YOUR-ACCOUNT/my-box-app@sha256:REPLACE_WITH_64_HEX_DIGEST",
  "architectures": ["arm64", "amd64"]
}
```

Add that object to the manifest’s `versions` array. Validate from the SDK checkout:

```sh
node bin/orenda-box-sdk.js validate ../my-box-app/orenda-app.json --release
```

The registry must allow Boxes to pull the image without publisher credentials. Declare only architectures you built. ARM64 is required for OrendaBox distribution. Use a new immutable version and digest for every update.

## Publish, review, install

1. Create a publisher account on Orenda Apps and complete your publisher profile.
2. Create an app with a clear description, category, support information, and the SDK runtime settings from `metadata.orenda` in your manifest. Your published app ID is namespaced to your publisher; the Box supplies the final ID in `ORENDA_APP_ID`.
3. Add the release image, digest, version and supported architectures. Explain why you need each requested capability.
4. Submit for administrator review. Drafts and pending submissions are not available to Box users. Address review feedback and resubmit when needed. Approved releases become available through the existing official catalog.
5. A Box administrator chooses the app in Edge Console, reviews the release's requested permissions, selects grants and any USB devices, and explicitly approves installation. Network and hardware access start disabled. Edge Console allocates a localhost port, starts the container, waits for `/health`, and registers launchable apps in the organization config. A failed update restores the previous managed compose configuration.
6. Grant access through the existing Box/organization access controls. App users also need access to Edge Console, because Connect opens apps through that authenticated proxy.

Marketplace approval is for the submitted release and permission requests. Changing a draft does not change the approved catalog. Updates go through marketplace review and a new Box installation consent step. Users can decline permissions; apps should show the affected feature as unavailable and explain the missing grant.

## Use Box services

```js
const { authenticateEdgeRequest, createRuntimeClient } = require('./sdk');

const user = authenticateEdgeRequest(request.headers);
if (!user) { /* return 401; direct browser identity headers are untrusted */ }

const runtime = createRuntimeClient();
const context = await runtime.context();
const settings = await runtime.config();       // requires config:read
const tags = await runtime.listPlcTags();       // requires plc:read
const readings = await runtime.readPlcTags(['temperature']);
const history = await runtime.metrics.queryRange('plc_tag_value', {
  start: Date.now() / 1000 - 3600, end: Date.now() / 1000, step: 60
});                                            // requires prometheus:read
const notes = runtime.mongo.collection('notes');
const saved = await notes.insertOne({ title: 'Shift handover', status: 'open' }); // mongodb:write
const openNotes = await notes.find({ status: 'open' }, { limit: 20 });          // mongodb:read
```

Keep these helpers on your server. The browser calls your own authenticated app API; it never receives the runtime token or proxy secret. Check the user’s roles before performing app mutations. PLC and Prometheus read capabilities cover their data across the Box; MongoDB access is isolated to the app’s own database. No service URL, database setup, username or password is required in app code. Enable only the capabilities you use in `metadata.orenda.capabilities`, then submit them for review.

See the [PLC, metrics and MongoDB cookbook](docs/core-services.md), [USB barcode scanners, printers, networking and HDMI guide](docs/hardware.md), [runtime APIs and ownership](docs/runtime-api.md), [manifest reference](docs/manifest.md), and [design and security constraints](docs/design-constraints.md). Existing services remain the source of their data; this SDK does not introduce another identity, organization, PLC, or database server.

Apps have no Internet or LAN access unless `network:outbound` is requested and granted at installation. Core service access uses the Edge runtime facade and its individual grants. USB access is limited to selected devices; HDMI uses the Box's existing authenticated app UI through a host-managed viewer. No host mounts, privileged containers, raw display sockets, or global USB access are required.

## Verify the SDK

```sh
npm test
npm run validate
```

Tests cover forged identity headers, scoped service calls, release validation, safe scaffolding, startup health and authenticated sessions. SDK v1 needs Edge Manager `0.2.36` and DevicePlatform `0.2.45` or newer. Each release must declare `minPlatformVersion: "0.2.45"` (or higher) so older images reject the installation safely.
