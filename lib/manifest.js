const CAPABILITIES = ['config:read', 'plc:read'];
function validateManifest(app, { release = false } = {}) {
  const errors = [];
  const sdk = app?.metadata?.orenda || {};
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(app?.id || '')) errors.push('id: use 2–120 lowercase letters, digits or hyphens');
  if (!String(app?.name || '').trim()) errors.push('name is required');
  if (app?.runtime !== 'compose') errors.push('runtime must be compose');
  if (sdk.sdkVersion !== '1') errors.push('metadata.orenda.sdkVersion must be "1"');
  if (!Number.isInteger(sdk.containerPort) || sdk.containerPort < 1024 || sdk.containerPort > 65535) errors.push('containerPort must be 1024–65535');
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(sdk.healthPath || '')) errors.push('healthPath must be a safe absolute path');
  if (typeof sdk.ui?.enabled !== 'boolean') errors.push('ui.enabled must be a boolean');
  if (!Array.isArray(sdk.capabilities) || sdk.capabilities.some((item) => !CAPABILITIES.includes(item))) errors.push('capabilities must use config:read and/or plc:read');
  if (release) {
    if (!app.versions?.length) errors.push('at least one version is required');
    for (const version of app.versions || []) {
      if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version.version || '')) errors.push('release version must be semantic');
      if (!version.architectures?.includes('arm64')) errors.push('release must support arm64');
      const minimum = /^\d+\.\d+\.\d+$/.test(version.minPlatformVersion || '') ? version.minPlatformVersion.split('.').map(Number) : null;
      if (!minimum || minimum[0] === 0 && (minimum[1] < 2 || minimum[1] === 2 && minimum[2] < 45)) errors.push('minPlatformVersion must be at least 0.2.45');
      if (!/@sha256:[a-f0-9]{64}$/i.test(version.image || '') && !/^sha256:[a-f0-9]{64}$/i.test(version.digest || '')) errors.push('release image must be pinned by sha256 digest');
    }
  }
  return errors;
}
module.exports = { validateManifest, CAPABILITIES };
