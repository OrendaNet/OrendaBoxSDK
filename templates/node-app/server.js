const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { authenticateEdgeRequest, createRuntimeClient } = require('./sdk');
const runtime = createRuntimeClient();
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'));
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && route === '/health') return json(200, { ok: true });
  const user = authenticateEdgeRequest(req.headers);
  if (!user) return json(401, { error: 'Open this app from Edge Console to continue' });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (route === '/api/session') return json(200, { user });
  if (route === '/api/context') {
    try { return json(200, await runtime.context()); }
    catch (error) { return json(error.status || 503, { error: error.message }); }
  }
  if (route === '/api/config') {
    try { return json(200, await runtime.config()); }
    catch (error) { return json(error.status || 503, { error: error.message }); }
  }
  if (route !== '/') return json(404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html);
});
server.listen(Number(process.env.PORT || 3101), process.env.HOST || '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
