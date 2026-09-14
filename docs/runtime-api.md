# Runtime APIs and ownership

The core app API is part of Edge Manager, which is already installed and managed by OrendaDevicePlatform. It runs on the existing port `8088`. Do not run a second control plane in an app.

## App credentials

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
| `POST /usb/devices/:id/read` | `usb:read` and selected-device read grant | `{ maxBytes?, timeoutMs? }` → `{ dataBase64, bytes }`; at most 4,096 bytes and a 5,000 ms timeout. |
| `POST /usb/devices/:id/write` | `usb:write` and selected-device write grant | `{ dataBase64 }` → `{ bytes }`; at most 65,536 decoded bytes. |

The PLC routes delegate to OrendaPLCLibrary on the Box. They do not create a second collector or copy its config. `plc:read` grants read access to configured tags across the Box. `prometheus:read` reads the existing Box metrics database; it cannot reload Prometheus, change rules, or run administrative operations. MongoDB routes use the existing core database and derive a private database namespace exclusively from the installed app identity. An app cannot supply a database name, connect URI, pipeline, or command. No shared Mongo credentials are returned to the container.

All permissions require explicit Box administrator consent at installation or update, in addition to marketplace review. Only the intersection of requested and granted capabilities is effective. USB also requires a selected-device grant; no runtime request can choose a host device path. `network:outbound` is a container network permission, and `display:present` permits the administrator to select this app for the host's local viewer. They do not introduce raw network-control or display-management API routes. See [hardware and networking](hardware.md).

`401` means the install credential is invalid; `403` means the needed permission was not granted; `404` means an app document or selected resource was not found; `413` means a storage/document limit was reached; `429` means the app should slow down; `502` means the underlying service is unavailable. Show a useful retry state and preserve unsaved input. Runtime requests are limited to 120 per minute and four simultaneous requests per app. PLC writes, device reconfiguration, shell access, database administration and organization mutations are not app runtime capabilities in v1.

The browser UI uses a trusted Edge parent and a sandboxed app frame on both HTTPS and ordinary HTTP Box LAN addresses. Query strings and internal links remain supported. Native form navigation preserves up to 1 MiB of submitted bytes. Permission or version changes refresh the app with GET; they never automatically repeat a form write. Keep browser state changes in ordinary authenticated app endpoints, and reserve paths beginning `__orenda/` and the query parameter `__orenda_frame` for Edge navigation. Core service credentials stay in your app server.

Prometheus queries are limited to 8,192 characters, a five-second evaluation timeout, a 4 MiB response, and 1,000 returned series. Range queries allow at most 31 days and 11,000 points with step >= 1 second; timestamps accept epoch seconds or ISO strings. Metric discovery returns at most 2,000 names. MongoDB allows 64 KiB per document, 10,000 documents, 32 collections and 128 MiB of data per app. Find returns 1–100 documents with skip up to 10,000 (at most approximately 6.4 MiB at the document-size limit). Queries have a two-second database deadline. The API supports scalar comparisons, `$in`/`$nin`, `$exists`, `$and` and `$or`, but rejects executable or arbitrary operators such as `$where`, `$regex`, `$expr`, and aggregation pipelines. See the cookbook for examples.

App settings are edited through the existing Edge `PUT /api/v1/apps/:id/config` route with an authenticated administrative user session and the current Box configuration revision. Apps consume their settings through the read-only runtime endpoint. Store domain data in the app-isolated MongoDB store or `/data` as appropriate. MongoDB documents and `/data` survive app updates and ordinary uninstall; keep backups before migrations and never inspect another app’s data.

## Browser identity and proxy

All app HTML, API, asset, SSE, and WebSocket requests go through `/api/v1/apps/:appId/ui`. Edge validates its user session, removes the browser’s Authorization header, and attaches verified identity headers. The SDK checks the proxy secret before trusting identity. Use these header names if implementing an SDK in another language:

`x-orenda-edge-proxy-secret`, `x-orenda-auth-source`, `x-orenda-user-id`, `x-orenda-username`, `x-orenda-user-name`, `x-orenda-user-roles`.

Require a nonempty secret, auth source, and username. Compare the secret in constant time. Never default a missing identity to an administrator. Render the app directly for an authenticated Edge user; show “Open this app from Edge Console” on `401`. Do not create a separate password or user-management system. Never expose Edge user bearer tokens, app runtime tokens, or proxy secrets to browser JavaScript or URLs.

Third-party UI runs in a browser sandbox with an opaque origin. It cannot read Edge Console localStorage, cookies, or other app windows. Edge exchanges the existing launch ticket for a short-lived app-only session directory: `/api/v1/apps/:appId/ui/~<opaque-session>/`. Relative assets, module imports, fetch, SSE and WebSocket paths stay beneath that directory. Edge verifies the session’s exact app ID and expiry and strips the directory before forwarding to your app. This URL grants access only to that app’s UI; never log or share the full launch URL. Responses use `no-store` and `Referrer-Policy: no-referrer`. Developers do not mint or copy session credentials or add tokens to EventSource query strings. Existing first-party app sessions keep their HttpOnly cookie behavior.

Use relative browser URLs, such as `fetch('api/session')`, and support a base URL (for Vite, use `base: './'`). The proxy preserves binary assets, streams SSE, and forwards WebSockets. `x-orenda-app-base-path` is available to HTTP backends that need to generate links. SDK apps cannot use localStorage, browser cookies, IndexedDB, service workers or embedded frames. Store preferences/domain state through your authenticated app API under `/data`. App cookies and arbitrary browser Authorization values are deliberately not forwarded by the proxy.

## Access and transport

Organization config `users[]`, `userGroups[]`, `devices[]`, and `apps[]` remain the source of access. Launchable installed apps register as `box:<Box wallet>:<appId>` and retain the existing `OrendaBoxTarget` fields. Edge performs existing authenticated organization app mutations; OrendaService alone derives publish rules and Diode whitelists. Registration failure is reported separately from a healthy installation and retried when Edge starts with organization access.

Connect desktop/mobile discover authorized Box app targets from org config and open `/?open=<appId>&projectId=<projectId>` on Edge Console. No credential is embedded in that URL. Both the Edge target and app target must grant the user the required access. API/TLS stays the default; explicit saved transport choices are retained.

Use the signed OrendaService API on `1453` only from the existing Edge integration. Never package pairing credentials, org admin credentials, fleet keys, or config-server tokens into an app. Organization user/admin APIs on `1454`/`1455` are not app-local storage services.
