"""Server-side bindings for the OrendaBox SDK."""
import hmac
import os

from aiohttp import ClientSession, ClientTimeout


def edge_identity(headers, secret):
    supplied = headers.get("x-orenda-edge-proxy-secret", "")
    if not secret or not hmac.compare_digest(secret.encode(), supplied.encode()):
        return None
    username = headers.get("x-orenda-username")
    source = headers.get("x-orenda-auth-source")
    if not username or not source:
        return None
    roles = {role.strip() for role in headers.get("x-orenda-user-roles", "").split(",")}
    return {"username": username, "source": source, "roles": roles}


class BoxRuntime:
    def __init__(self, url, token):
        self.url = url.rstrip("/")
        self._token = token
        self._http = None

    @classmethod
    def from_environment(cls):
        url = os.environ.get("ORENDA_EDGE_API_URL")
        return cls(url, os.environ["ORENDA_APP_TOKEN"]) if url else None

    async def _request(self, method, path, body=None):
        if self._http is None:
            self._http = ClientSession(timeout=ClientTimeout(total=5))
        async with self._http.request(method, self.url + path, json=body, allow_redirects=False,
                headers={"Authorization": "Bearer " + self._token}) as response:
            if response.status != 200:
                raise RuntimeError("Box service returned HTTP " + str(response.status))
            return await response.json()

    async def context(self):
        return await self._request("GET", "/context")

    async def publish_channels(self, channels):
        """Replace this app's selected readings. Use None for unavailable values."""
        return await self._request("POST", "/prometheus/channels", {"channels": channels})

    async def close(self):
        if self._http:
            await self._http.close()
            self._http = None
