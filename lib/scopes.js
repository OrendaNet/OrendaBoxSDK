const crypto = require('crypto');

const SCOPED_CAPABILITIES = ['data:read', 'documents:read', 'documents:process', 'ai:invoke', 'app:invoke', 'jobs:run', 'storage:artifacts', 'compute:python'];
const EXPORT_CLASSES = ['machine-context', 'telemetry', 'document-excerpt', 'maintenance-history', 'production-records'];
const CAP_SCOPE = { 'data:read': 'data', 'documents:read': 'documents', 'documents:process': 'documents', 'ai:invoke': 'ai', 'app:invoke': 'apps', 'jobs:run': 'jobs', 'storage:artifacts': 'storage', 'compute:python': 'compute' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function strings(v, name, max = 1000) {
  if (!Array.isArray(v) || v.length > max || new Set(v).size !== v.length || v.some((s) => typeof s !== 'string' || !s.length || s.length > 200 || s === '*')) throw fail(`Invalid ${name}; use explicit distinct identifiers`);
}
const LIMITS = { maxWindowSeconds: [1, 2678400], maxRows: [1, 10000], maxBytes: [1, 16777216], maxInputBytes: [1, 16777216], maxOutputTokens: [1, 32768], maxSeconds: [1, 86400], maxConcurrent: [1, 4], maxArtifactBytes: [1, 67108864] };
const KEYS = { data: ['machineIds', 'tagNames', 'deviceIds', 'metricNames', 'harnesses', 'maxWindowSeconds', 'maxRows', 'maxBytes'], documents: ['machineIds', 'states', 'maxBytes'], ai: ['profiles', 'exportClasses', 'maxInputBytes', 'maxOutputTokens'], apps: ['targets'], jobs: ['maxSeconds', 'maxConcurrent', 'allowSchedules'], storage: ['maxArtifactBytes'], compute: ['profiles'] };
function validateScopes(scopes, capabilities, grant = false) {
  if (!plain(scopes) || Object.keys(scopes).some((k) => !KEYS[k])) throw fail('SDK 2 requires known scope objects');
  for (const cap of capabilities) if (CAP_SCOPE[cap] && !plain(scopes[CAP_SCOPE[cap]])) throw fail(`${cap} requires its ${CAP_SCOPE[cap]} scope`);
  for (const [name, scope] of Object.entries(scopes)) {
    if (!plain(scope) || Object.keys(scope).some((k) => !KEYS[name].includes(k))) throw fail(`Unknown ${name} scope field`);
    for (const [key, value] of Object.entries(scope)) {
      if (LIMITS[key]) { const [min, max] = LIMITS[key]; if (!Number.isInteger(value) || value < min || value > max) throw fail(`Invalid ${name}.${key}`); }
      else if (key === 'allowSchedules') { if (typeof value !== 'boolean') throw fail('allowSchedules must be boolean'); }
      else if (key === 'targets') {
        if (!Array.isArray(value) || value.length > 16 || new Set(value.map((t) => t.appId)).size !== value.length) throw fail('Invalid app targets');
        for (const t of value) { if (!plain(t) || Object.keys(t).some((k) => !['appId', 'operations'].includes(k)) || !/^[a-z0-9][a-z0-9-]{1,119}$/.test(t.appId)) throw fail('Invalid app target'); strings(t.operations, 'operations', 32); }
      } else strings(value, `${name}.${key}`);
    }
    const required = { data: ['machineIds', 'maxWindowSeconds', 'maxRows', 'maxBytes'], documents: ['machineIds', 'states', 'maxBytes'], ai: ['profiles', 'exportClasses', 'maxInputBytes', 'maxOutputTokens'], apps: ['targets'], jobs: ['maxSeconds', 'maxConcurrent', 'allowSchedules'], storage: ['maxArtifactBytes'], compute: ['profiles'] }[name];
    if (required.some((k) => scope[k] === undefined)) throw fail(`Incomplete ${name} scope`);
    if (grant && ['data', 'documents'].includes(name) && !scope.machineIds.length) throw fail('Select explicit machine IDs before granting data access');
    if (name === 'ai' && (scope.profiles.some((x) => !['hosted', 'customer'].includes(x)) || scope.exportClasses.some((x) => !EXPORT_CLASSES.includes(x)))) throw fail('Unknown inference profile or export class');
    if (name === 'documents' && scope.states.some((x) => !['approved'].includes(x))) throw fail('Only approved documents can be read');
  }
  return JSON.parse(JSON.stringify(scopes));
}
function subset(request, grant, name = '') {
  if (Array.isArray(request)) {
    // Catalog manifests leave machine selection empty; installation must select it.
    if (['machineIds', 'deviceIds', 'tagNames'].includes(name) && !request.length) return;
    if (name === 'targets') { for (const t of grant) { const r = request.find((v) => v.appId === t.appId); if (!r) throw fail('App target exceeds requested scope'); subset(r.operations, t.operations, 'operations'); } }
    else if (grant.some((v) => !request.includes(v))) throw fail(`${name} exceeds requested scope`);
  } else if (plain(request)) {
    for (const [k, v] of Object.entries(grant)) { if (!Object.hasOwn(request, k)) throw fail(`${k} was not requested`); subset(request[k], v, k); }
  } else if (typeof request === 'number' ? grant > request : typeof request === 'boolean' ? grant && !request : grant !== request) throw fail(`${name} exceeds requested scope`);
}
function approveScopes(sdk, capabilities, input) {
  if (sdk?.sdkVersion !== '2') return {};
  const selected = Object.fromEntries(Object.entries(input || {}).filter(([k]) => capabilities.some((c) => CAP_SCOPE[c] === k) || k === 'data' && capabilities.includes('app:invoke')));
  const scopes = validateScopes(selected, capabilities, true);
  subset(sdk.scopes, scopes);
  return { grantedScopes: scopes };
}
function validateWorkers(workers = []) {
  if (!Array.isArray(workers) || workers.length > 8 || new Set(workers.map((w) => w.id)).size !== workers.length) throw fail('Invalid worker profiles');
  for (const w of workers) {
    if (!plain(w) || Object.keys(w).some((k) => !['id', 'command', 'memoryMb', 'cpu', 'pids', 'maxSeconds', 'maxInputBytes', 'maxOutputBytes'].includes(k)) || !/^[a-z][a-z0-9-]{0,31}$/.test(w.id)) throw fail('Invalid worker profile');
    if (!Array.isArray(w.command) || !w.command.length || w.command.length > 8 || w.command.some((s) => typeof s !== 'string' || !s.length || s.length > 256 || s.includes('\0'))) throw fail('Worker command must be a fixed argument array');
    for (const [k, min, max] of [['memoryMb', 64, 2048], ['cpu', .1, 2], ['pids', 8, 128], ['maxSeconds', 1, 300], ['maxInputBytes', 1, 16777216], ['maxOutputBytes', 1, 16777216]]) if (typeof w[k] !== 'number' || w[k] < min || w[k] > max || k !== 'cpu' && !Number.isInteger(w[k])) throw fail(`Invalid worker ${k}`);
  }
}
function grantFingerprint(app) { return crypto.createHash('sha256').update(JSON.stringify([app.id, app.version, app.sdk || app.runtimeService, app.grantedCapabilities, app.grantedScopes, app.resourceBindings, app.permissionsApprovedAt])).digest('hex'); }
function effectiveScope(app, name) { return app.grantedScopes?.[name] || {}; }
function selectMachines(app, requested, parent) {
  strings(requested, 'machineIds');
  const scope = effectiveScope(app, 'data').machineIds || effectiveScope(app, 'documents').machineIds || [];
  if (!requested.length || requested.some((id) => !scope.includes(id) || Array.isArray(parent) && !parent.includes(id))) throw fail('Requested machines are outside the approved delegation', 403);
  return [...requested];
}
module.exports = { SCOPED_CAPABILITIES, EXPORT_CLASSES, CAP_SCOPE, validateScopes, approveScopes, validateWorkers, grantFingerprint, effectiveScope, selectMachines, fail, strings };
