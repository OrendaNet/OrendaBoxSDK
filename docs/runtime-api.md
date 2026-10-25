# Runtime APIs and ownership

The core app API is part of Edge Manager, which is already installed and managed by OrendaDevicePlatform. It runs on the existing port `8088`. Do not run a second control plane in an app.

## App credentials

### SDK 2 scoped operator writes (SCADA candidate)

The coordinated SCADA Studio candidate adds `plc:write` to **SDK 2 only**. It is not a legacy runtime permission. Edge Manager, the PLC collector and the catalog capability validator must all include the matching release before an app requests it.

Call `runtime.data.plcWrite(writes, { delegation, orgAddress, requestId })`. Each write is `{ tag, value }`, with a finite number or boolean; one request accepts 1–16 distinct tags. `requestId` is a stable UUID for that operator action. The app must declare and receive `plc:write` and `data:read`, plus approved machine/device/tag bindings and the `plc` harness. Edge revalidates the current actor's operator permission and the signed delegation. A display identity cannot write.

Edge calls the private collector's `/api/write-scoped` endpoint with the exact device bindings and the `device-write-v1` contract. The collector validates the complete batch against current tag definitions, snapshots the driver/addresses, checks raw PLC value types/ranges, and acknowledges the bound device/tag after each write. This does not convert engineering-unit read scaling back into register values. PLC commands use raw units.

The host persists command intent before dispatch and never repeats an uncertain command. A successful retry with the same UUID/body returns its retained acknowledgement; changed bodies conflict. A partially applied hardware batch cannot be rolled back: the response fails and the operator must inspect the machine. Acknowledged host ledger entries are retained for seven days; unresolved entries are retained until reviewed, with a 10,000-entry cap. Do not recycle request UUIDs or retry a failed command with a new UUID automatically.

SDK 2 HDMI sessions can read only the selected app's currently approved machine scope and are bound to the active host display selection. They cannot create jobs, invoke another app or send PLC commands. An explicitly empty app-to-app machine scope may create an empty inference job; it never expands into the target app's machine grants.

Edge injects the following environment variables when it installs an SDK app:

| Variable | Purpose |
| --- | --- |
| `ORENDA_APP_ID` | Publisher-namespaced app ID. Do not hard-code the ID. |
| `ORENDA_APP_DATA_DIR` | Writable, persistent `/data` volume. |
| `ORENDA_EDGE_API_URL` | Base URL for the existing Edge runtime routes. |
| `ORENDA_APP_TOKEN` | Opaque, per-install credential for those routes only. |
| `ORENDA_EDGE_APP_PROXY_SECRET` | Per-app secret for authenticating Edge-proxied browser requests. |
| `HOST`, `PORT` | Container listener address and port. |

Send `Authorization: Bearer <ORENDA_APP_TOKEN>` from the app server to `ORENDA_EDGE_API_URL`. This token is not an Edge user token and cannot call administrative Edge routes. It only works while the app appears in the installed inventory. Removing an app revokes access. Credentials are retained for an ordinary app update; do not log or return them.

SDK apps get separate proxy secrets. Existing first-party systemd/compose apps keep the shared `/etc/orenda/app-proxy.env` convention. A third-party container never receives that Box-wide shared secret.

## Endpoints

Paths below are relative to `/api/v1/runtime`:

| Method/path | Capability | Response |
| --- | --- | --- |
| `GET /context` | Installed app | `apiVersion`, `appId`, `appVersion`, `platformVersion`, currently granted `capabilities`, service availability, `dataDirectory`. |
| `GET /config` | `config:read` | `{ appId, config }` containing only this app’s Edge-managed settings. |
| `GET /plc/tags` | `plc:read` | Existing PLC collector `/api/tags` response. |
| `POST /plc/read` | `plc:read` | Existing PLC collector `/api/read` response for `{ "tags": ["name"] }`. Between 1 and 100 tag names. |
| `POST /prometheus/query` | `prometheus:read` | `{ query, time? }`; returns the existing Prometheus instant-query envelope. |
| `POST /prometheus/query-range` | `prometheus:read` | `{ query, start, end, step }`; returns the existing range-query envelope. |
| `GET /prometheus/metrics?prefix=plc_` | `prometheus:read` | `{ metrics, truncated }`; up to 2,000 metric names with the optional prefix. |
| `GET /mongodb/collections` | `mongodb:read` | This app’s collection names and storage limits. |
| `POST /mongodb/collections/:name/find` | `mongodb:read` | `{ filter?, sort?, limit?, skip? }` → `{ documents, limit, skip }`. |
| `GET /mongodb/collections/:name/documents/:id` | `mongodb:read` | `{ document }` or `404`. |
| `POST /mongodb/collections/:name/documents` | `mongodb:write` | `{ document }` → `{ insertedId }`; Box-generated string UUID. |
| `PUT /mongodb/collections/:name/documents/:id` | `mongodb:write` | `{ document }`; replaces this document while preserving its ID. |
| `DELETE /mongodb/collections/:name/documents/:id` | `mongodb:write` | `{ deletedCount }`; deletes this one document. |
| `GET /usb/devices` | USB grant | `{ devices }`; only this app's selected devices, with opaque `id`, `name`, `type`, `read`, `write`, and optional `baudRate`. |
| `POST /usb/devices/:id/read` | `usb:read` and selected-device read grant | `{ maxBytes?, timeoutMs? }` → `{ dataBase64, bytes, reports? }`; at most 4,096 bytes and a 5,000 ms timeout. HID `reports` preserves complete report boundaries in base64. |
| `POST /usb/devices/:id/write` | `usb:write` and selected-device write grant | `{ dataBase64 }` → `{ bytes }`; at most 65,536 decoded bytes. |
| `GET /usb/devices/:id/camera/stream` | SDK `1.1`, `usb:read`, selected camera read grant | Multipart JPEG stream; optional `width`, `height`, `fps`. `cameraStream()` returns `{ body, contentType }` and accepts an abort signal. See [camera bounds and forwarding](hardware.md#usb-cameras). |
| `GET /hotspot` | SDK `1.2`, `hotspot:manage` | Hotspot state: `configured`, `enabled`, `active`, `ssid`, `internetAccess`, `autoStart`, `interface`, `address`, secure `portalUrl`, first-use `portalSetupUrl`, connected `clients`, and an `uplink` summary (`wifiConnected`, `alternateUplink`, `canReleaseWifi`). The stored password is never returned. |
| `PUT /hotspot` | SDK `1.2`, `hotspot:manage` | `{ ssid?, password?, internetAccess?, autoStart? }` merges and stores the settings; setting `autoStart` does not restart a running hotspot. Send an empty password to keep the current one. On boot, Edge Manager starts an opted-in hotspot only when it can safely free the WiFi radio; it keeps the Box online through an independently routed Ethernet or mobile uplink. |
| `POST /hotspot/start` | SDK `1.2`, `hotspot:manage` | Starts the access point on a WiFi adapter that is not the active uplink. |
| `POST /hotspot/stop` | SDK `1.2`, `hotspot:manage` | Stops the access point and clears its forwarding policy. Settings are retained for the next start. |
| `POST /hotspot/uplink/disconnect` | SDK `1.2`, `hotspot:manage` | Explicit operator action: releases every connected WiFi uplink so the hotspot can use the radio. Only runs when a non-WiFi default route (Ethernet or mobile broadband) will keep the Box reachable; otherwise `409` and no change. Returns `{ released, releasedDevices, alternateUplink }`, or `{ released:false, reason:"no-wifi-uplink" }`. |

The PLC routes delegate to OrendaPLCLibrary on the Box. They do not create a second collector or copy its config. `plc:read` grants read access to configured tags across the Box. `prometheus:read` reads the existing Box metrics database; it cannot reload Prometheus, change rules, or run administrative operations. MongoDB routes use the existing core database and derive a private database namespace exclusively from the installed app identity. An app cannot supply a database name, connect URI, pipeline, or command. No shared Mongo credentials are returned to the container.

All permissions require explicit Box administrator consent at installation or update, in addition to marketplace review. Only the intersection of requested and granted capabilities is effective. USB also requires a selected-device grant; no runtime request can choose a host device path. `network:outbound` is a container network permission, and `display:present` permits the administrator to select this app for the host's local viewer. `hotspot:manage` exposes only the scoped hotspot settings and lifecycle routes: the app cannot select interfaces, forward ports, or run arbitrary host commands, and the Box retains the internet-sharing policy. The app may request releasing a WiFi uplink, but the Box refuses unless a non-WiFi default route would keep it reachable. See [hardware and networking](hardware.md).

`401` means the install credential is invalid; `403` means the needed permission was not granted; `404` means an app document or selected resource was not found; `413` means a storage/document limit was reached; `429` means the app should slow down; `502` means the underlying service is unavailable. Show a useful retry state and preserve unsaved input. Runtime requests are limited to 120 per minute and four simultaneous requests per app. PLC writes, device reconfiguration, shell access, database administration and organization mutations are not app runtime capabilities in v1.

The browser UI uses a trusted Edge parent and a sandboxed app frame on both HTTPS and ordinary HTTP Box LAN addresses. Query strings and internal links remain supported. Native form navigation preserves up to 1 MiB of submitted bytes. Permission or version changes refresh the app with GET; they never automatically repeat a form write. Keep browser state changes in ordinary authenticated app endpoints, and reserve paths beginning `__orenda/` and the query parameter `__orenda_frame` for Edge navigation. Core service credentials stay in your app server.

Prometheus queries are limited to 8,192 characters, a five-second evaluation timeout, a 4 MiB response, and 1,000 returned series. Range queries allow at most 31 days and 11,000 points with step >= 1 second; timestamps accept epoch seconds or ISO strings. Metric discovery returns at most 2,000 names. MongoDB allows 64 KiB per document, 10,000 documents, 32 collections and 128 MiB of data per app. Find returns 1–100 documents with skip up to 10,000 (at most approximately 6.4 MiB at the document-size limit). Queries have a two-second database deadline. The API supports scalar comparisons, `$in`/`$nin`, `$exists`, `$and` and `$or`, but rejects executable or arbitrary operators such as `$where`, `$regex`, `$expr`, and aggregation pipelines. See the cookbook for examples.

App settings are edited through the existing Edge `PUT /api/v1/apps/:id/config` route with an authenticated administrative user session and the current Box configuration revision. Apps consume their settings through the read-only runtime endpoint. Store domain data in the app-isolated MongoDB store or `/data` as appropriate. MongoDB documents and `/data` survive app updates and ordinary uninstall; keep backups before migrations and never inspect another app’s data.

## Browser identity and proxy

All app HTML, API, asset, SSE, and WebSocket requests go through `/api/v1/apps/:appId/ui`. Edge validates its user session, removes the browser’s Authorization header, and attaches verified identity headers. The SDK checks the proxy secret before trusting identity. Use these header names if implementing an SDK in another language:

`x-orenda-edge-proxy-secret`, `x-orenda-auth-source`, `x-orenda-user-id`, `x-orenda-username`, `x-orenda-user-name`, `x-orenda-user-roles`.

Require a nonempty secret, auth source, and username. Compare the secret in constant time. Never default a missing identity to an administrator. Render the app directly for an authenticated Edge user; show “Open this app from Edge Console” on `401`. Do not create a separate password or user-management system. Never expose Edge user bearer tokens, app runtime tokens, or proxy secrets to browser JavaScript or URLs.

Third-party UI runs in a browser sandbox with an opaque origin. It cannot read Edge Console localStorage, cookies, or other app windows. Edge exchanges the existing launch ticket for a short-lived app-only session directory: `/api/v1/apps/:appId/ui/~<opaque-session>/`. Relative assets, module imports, fetch, SSE and WebSocket paths stay beneath that directory. Edge verifies the session’s exact app ID and expiry and strips the directory before forwarding to your app. This URL grants access only to that app’s UI; never log or share the full launch URL. App responses use `no-store` and `Referrer-Policy: no-referrer`; the trusted parent permits same-origin referrers for its internal navigation requests. Developers do not mint or copy session credentials or add tokens to EventSource query strings. Existing first-party app sessions keep their HttpOnly cookie behavior.

Use relative browser URLs, such as `fetch('api/session')`, and support a base URL (for Vite, use `base: './'`). The proxy preserves binary assets, streams SSE, and forwards WebSockets. `x-orenda-app-base-path` is available to HTTP backends that need to generate links. SDK apps cannot use localStorage, browser cookies, IndexedDB, service workers or embedded frames. Store preferences/domain state through your authenticated app API under `/data`. App cookies and arbitrary browser Authorization values are deliberately not forwarded by the proxy.

## Access and transport

### Private continuation for hosted tool calls

Hosted inference may also advertise `reasoningContinuation: true` in limit discovery. An updated caller can opt in with `continuationSupport: true` on its existing inference request. Retain the returned assistant `reasoningRef` unchanged alongside its content and ordered tool calls, followed by the corresponding tool results. The reference is valid only in the same authorized run. Include its `exportClasses` in the request's approved export provenance and its `inputBytes` in input-budget checks. The host retains the actual provider continuation encrypted; apps never receive raw reasoning. Compaction can omit a whole reference but must not modify it or truncate its associated assistant content/arguments. If the host rejects an expired/deleted reference with `CONTINUATION_UNAVAILABLE` before dispatch, retry once from the retained visible evidence without references. Existing paid-request reconciliation still applies. Customers cannot change model or reasoning policy through this mechanism.

### Typed screenshot evidence for inference

The coordinated SCADA visual-review update adds optional `imageInput` and `maxInputBytes` fields to inference limit discovery. A caller must check `imageInput === true` before sending an image. This requires matching Edge Manager and hosted AI Backend versions; it does not change app grants, model selection or network permissions.

One message may contain text and one `image_url` part using an inline `data:image/jpeg;base64,...` URL. Images are allowed only in a `user` message with `dataClass: "machine-context"`, and that export class must be approved. The image is limited to 96 KiB decoded and 1400 pixels on each axis; only `detail: "high"` is supported. Remote URLs, additional images and other image formats are rejected. The existing total input byte grant still applies. The hosted token reservation uses a conservative 16,384-token image allowance alongside the ordinary text bound; provider usage and charges are settled normally.

SCADA requests and returns rendered draft screenshots through the existing approved `designs.create` app operation. A capture response contains `reviewOf`, a one-use `requestId`, the exact `draftHash`, and `render: {dataUrl,width,height}`. The Agent verifies actor ownership and the pending draft before accepting it. Screenshots are transient inference evidence; the design job retains dimensions, hashes and review findings, not the image bytes. The Agent and workers retain their existing network isolation.

Organization config `users[]`, `userGroups[]`, `devices[]`, and `apps[]` remain the source of access. Launchable installed apps register as `box:<Box wallet>:<appId>` and retain the existing `OrendaBoxTarget` fields. Edge performs existing authenticated organization app mutations; OrendaService alone derives publish rules and Diode whitelists. Registration failure is reported separately from a healthy installation and retried when Edge starts with organization access.

Connect desktop/mobile discover authorized Box app targets from org config and open `/?open=<appId>&projectId=<projectId>` on Edge Console. No credential is embedded in that URL. Both the Edge target and app target must grant the user the required access. API/TLS stays the default; explicit saved transport choices are retained.

Use the signed OrendaService API on `1453` only from the existing Edge integration. Never package pairing credentials, org admin credentials, fleet keys, or config-server tokens into an app. Organization user/admin APIs on `1454`/`1455` are not app-local storage services.
