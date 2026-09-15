# App manifest

The SDK uses the existing AppRepo catalog shape. Put the app runtime contract in `metadata.orenda`; do not submit an executable compose file or a systemd unit.

```json
{
  "id": "my-app",
  "name": "Production overview",
  "runtime": "compose",
  "metadata": {
    "orenda": {
      "sdkVersion": "1",
      "containerPort": 3101,
      "healthPath": "/health",
      "ui": { "enabled": true },
      "capabilities": ["config:read", "plc:read"]
    }
  },
  "versions": []
}
```

| Field | Constraint |
| --- | --- |
| `id` | 2–120 lowercase letters, digits, hyphens; starts with a letter/digit. The publisher service assigns the final namespace. |
| `runtime` | `compose` for SDK v1. Existing first-party systemd apps are unchanged. |
| `sdkVersion` | String `"1"` for existing services, or `"1.1"` for USB camera capture (Edge Manager `0.2.39+`). Older Edge versions reject `1.1` before installation. |
| `containerPort` | Integer `1024..65535`. The Box allocates the host port; an app cannot select another service’s port. |
| `healthPath` | Absolute HTTP path containing letters, digits, `/`, `_`, or `-`. Respond with 2xx once ready. Health contains no sensitive information and is the only anonymous starter endpoint. |
| `ui.enabled` | `true` for a user-facing app, `false` for a background service. Headless apps are installed and managed without an Open button. |
| `capabilities` | Requested permissions from the table below. Use an empty array when no Box services, USB devices, local display, or outbound network access are needed. A manifest request and marketplace review do not grant permission on a Box. |
| `versions[].version` | A new semantic version for every release. |
| `versions[].image` | Publicly pullable registry image pinned with `@sha256:<64 hex>`, or `digest` alongside the image reference. |
| `versions[].architectures` | Include `arm64`; optionally `amd64` when that image was built. |
| `versions[].minPlatformVersion` | At least `0.2.45`, so older Box images cannot use the legacy installer for an SDK app. |

Build-time image digests and architectures describe the immutable release, not the local developer machine. The catalog also supports verified hosted Docker image artifacts through existing AppRepo artifact routes. The starter uses registry images because that is the shortest reproducible workflow.

Resource constraints are managed by the Box: a private compose project/network, UID/GID `1000:1000`, read-only root, dropped Linux capabilities, no privilege escalation, 512 MB memory, one CPU, 256 processes and a temporary `/tmp`. Prepare `/data` with ownership `1000:1000` in the image. Apps cannot submit privileged containers, host-network mode, arbitrary host mounts, Docker socket access, or commands that run as root. Request an architectural review when your app cannot fit this contract.

## Declare permissions, then obtain installation consent

| Capability | Access when granted by the Box administrator |
| --- | --- |
| `config:read` | This app's Edge-managed settings. |
| `plc:read` | Configured PLC tag names and values across this Box. |
| `prometheus:read` | Read queries and metric discovery across this Box. |
| `mongodb:read` | Collections and documents in this app's private database. |
| `mongodb:write` | Create, replace, and delete documents in this app's private database. |
| `usb:read` | Read bytes or, with SDK `1.1`, camera video from USB devices explicitly selected for this app. |
| `usb:write` | Write bytes to USB devices explicitly selected for this app. |
| `display:present` | Allow the administrator to select this app's UI for the Box's local HDMI display. |
| `network:outbound` | Outbound Internet and LAN connections from the app container. |

Edge Console presents these permissions before installing or updating. The administrator explicitly acknowledges the current release and selects its grants, including individual USB devices and read/write access. Consent is bound to the app's current release and manifest; changing either requires a new review. An app cannot approve itself or gain permissions just by changing its image. Request only what the feature needs and handle declined permissions with a clear explanation. `context().capabilities` reports the currently granted permissions, which can be fewer than those requested.

Without `network:outbound`, the app has an isolated network with access to the authenticated Edge runtime facade. It cannot reach the Internet or LAN. Box core APIs continue to work with their separate grants; apps do not need outbound access to query PLC, Prometheus, or MongoDB. Outbound permission does not expose arbitrary Box host services. The image is pulled by the Box installer and does not require the app to have network permission.

See [USB, networking and local display](hardware.md) for examples and hardware limits.
