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
| `sdkVersion` | String `"1"`. |
| `containerPort` | Integer `1024..65535`. The Box allocates the host port; an app cannot select another service’s port. |
| `healthPath` | Absolute HTTP path containing letters, digits, `/`, `_`, or `-`. Respond with 2xx once ready. Health contains no sensitive information and is the only anonymous starter endpoint. |
| `ui.enabled` | `true` for a user-facing app, `false` for a background service. Headless apps are installed and managed without an Open button. |
| `capabilities` | Array drawn from `config:read`, `plc:read`, `prometheus:read`, `mongodb:read`, and `mongodb:write`. Use an empty array when no Box service access is needed. Request MongoDB read and write for a typical app data store, or read alone for a viewer. |
| `versions[].version` | A new semantic version for every release. |
| `versions[].image` | Publicly pullable registry image pinned with `@sha256:<64 hex>`, or `digest` alongside the image reference. |
| `versions[].architectures` | Include `arm64`; optionally `amd64` when that image was built. |
| `versions[].minPlatformVersion` | At least `0.2.45`, so older Box images cannot use the legacy installer for an SDK app. |

Build-time image digests and architectures describe the immutable release, not the local developer machine. The catalog also supports verified hosted Docker image artifacts through existing AppRepo artifact routes. The starter uses registry images because that is the shortest reproducible workflow.

Resource constraints are managed by the Box: a private compose project/network, UID/GID `1000:1000`, read-only root, dropped Linux capabilities, no privilege escalation, 512 MB memory, one CPU, 256 processes and a temporary `/tmp`. Prepare `/data` with ownership `1000:1000` in the image. Apps cannot submit privileged containers, host-network mode, arbitrary host mounts, Docker socket access, or commands that run as root. Request an architectural review when your app cannot fit this contract.
