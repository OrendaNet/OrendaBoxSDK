const crypto = require('node:crypto');

function header(headers, name) {
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name];
  return Array.isArray(value) ? '' : String(value || '').trim();
}

function authenticateEdgeRequest(headers, secret = process.env.ORENDA_EDGE_APP_PROXY_SECRET) {
  const provided = Buffer.from(header(headers, 'x-orenda-edge-proxy-secret'));
  const expected = Buffer.from(String(secret || ''));
  if (!expected.length || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
  const username = header(headers, 'x-orenda-username');
  const source = header(headers, 'x-orenda-auth-source');
  if (!username || !source) return null;
  return {
    id: header(headers, 'x-orenda-user-id') || username,
    username,
    name: header(headers, 'x-orenda-user-name') || username,
    roles: header(headers, 'x-orenda-user-roles').split(',').map((role) => role.trim()).filter(Boolean),
    source
  };
}

function requireEdgeUser(req, res, next) {
  req.user = authenticateEdgeRequest(req.headers);
  if (req.user) return next();
  res.writeHead(401, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ error: 'Open this app from Edge Console to continue' }));
}

function createRuntimeClient({ baseUrl = process.env.ORENDA_EDGE_API_URL, token = process.env.ORENDA_APP_TOKEN, fetchImpl = fetch } = {}) {
  const request = async (route, body) => {
    if (!baseUrl || !token) throw new Error('OrendaBox runtime credentials are unavailable; install through Edge Console');
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const error = new Error(`OrendaBox API ${route} returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  return {
    context: () => request('/context'),
    config: () => request('/config'),
    listPlcTags: () => request('/plc/tags'),
    readPlcTags: (tags) => request('/plc/read', { tags })
  };
}

module.exports = { authenticateEdgeRequest, requireEdgeUser, createRuntimeClient };
