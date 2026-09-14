# Design constraints

Apps should feel like part of OrendaBox. The starter gives you a restrained green/teal palette, a readable system font, clear page titles, generous whitespace, soft borders and 8–14 px corner radii. Keep these visual relationships when using another frontend framework.

- Start with the user’s task. Use one clear page heading, a short explanation when useful, and a primary action named for its outcome.
- Use Edge Console identity. Show the current user or workspace when it helps; do not ask an already signed-in user to log in again.
- Support narrow mobile screens from 320 px and desktop windows. Let content reflow and avoid fixed-width dashboards. Keep touch targets at least 44 px.
- Every input needs a visible label. Preserve keyboard navigation, visible focus, semantic headings, sufficient contrast, and screen-reader status/alert messages. Never communicate state with color alone.
- Model loading, empty, denied, offline, error, retry, and success states. Keep a retry button near the failed action. Preserve unsaved inputs. Do not show a spinner indefinitely.
- Explain requested permissions in ordinary language before submission. “Read configured PLC tag values” helps a reviewer; an unexplained `plc:read` badge does not.
- Installation and updates require explicit Box administrator permission approval. Honor declined grants, including individual USB devices, Internet/LAN access and the local display; explain which feature needs the grant without repeatedly prompting the user.
- Make destructive app-data actions deliberate and specific. Explain which data will change, and provide recovery where feasible. Installing or opening an app should not silently change PLC configuration.
- Avoid fake sample production data. Clearly mark demos and development mode. Do not claim a successful save until it succeeds.

## Runtime and security

- Use Linux ARM64 images. Listen on the supplied container `HOST` and `PORT`; Edge publishes only the allocated localhost host port.
- Run as UID/GID `1000:1000`. Write durable data only under `/data` and temporary files under `/tmp`. Support SIGTERM gracefully, health checks, reproducible image builds and versioned data migrations.
- Validate Edge proxy identity for every protected request, including app API and WebSocket upgrades. Health endpoints must disclose only readiness. Map unknown roles to a conservative level.
- User identity and the app runtime credential are different: a runtime token proves an installed app, not a person. Your app still enforces user authorization before domain mutations and exposing sensitive PLC data.
- Keep secrets server-side. Redact tokens/passwords from errors and logs, use dependency updates, validate inputs, and avoid public port bindings, shell interpolation and arbitrary URL forwarding.
- Use the scoped runtime facade for core Box services: existing PLC reads, Prometheus queries, and app-isolated MongoDB persistence. Never mount the Docker socket, provision a parallel org config/database/collector, pair directly with OrendaService, create publish rules, or distribute fleet credentials.
- Keep outbound Internet/LAN disabled unless `network:outbound` is requested and granted. Use the USB facade only for selected devices, and render HDMI through the host-owned app viewer. Do not open host device paths, raw input streams, compositor sockets or unrelated host services.
- SDK UI runs in an opaque browser sandbox so third-party code cannot read Edge Console credentials. Use relative assets and module imports; keep persistent state on the app server. Browser cookies, localStorage, IndexedDB, service workers and embedded frames are unavailable. Do not log or share the temporary app-session launch URL.
- Respect third-party software licenses and attribution. A reviewer needs a support route, a clear description of data access, and release notes that describe behavioral or permission changes.

Review validates the submitted metadata and release, but application code still needs its own tests and security review. Container constraints reduce privileges; they are not a substitute for reviewing untrusted software.
