const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const { deriveDeviceId, formatGroups } = require('./licenseKey');

let cachedFingerprint = null;

// Identifies this specific PC. Prefers the Windows machine GUID (stable
// across reinstalls, survives OS updates) via the stock `reg` command — no
// new dependency, no native addon, avoids the esbuild bundling issues
// native/`__dirname`-relative packages hit (see scripts/build-server.js's
// pdfkit comment). Falls back to a hash of coarse hardware/OS details if the
// registry read fails for any reason.
function getMachineFingerprint() {
  if (cachedFingerprint) return cachedFingerprint;
  let raw = null;
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 3000 }).toString();
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    raw = match ? match[1] : null;
  } catch {
    raw = null;
  }
  if (!raw) {
    raw = `${os.hostname()}|${(os.cpus()[0] || {}).model || ''}|${os.totalmem()}`;
  }
  cachedFingerprint = crypto.createHash('sha256').update(raw).digest('hex');
  return cachedFingerprint;
}

// Short, human-shareable code (e.g. "K7QX-9F2M-3RWT") derived from the
// machine fingerprint — this is what's shown on the activation screen for the
// school to read out/send to the developer.
function getDeviceId() {
  return deriveDeviceId(getMachineFingerprint());
}

function getFormattedDeviceId() {
  return formatGroups(getDeviceId(), 4);
}

module.exports = { getMachineFingerprint, getDeviceId, getFormattedDeviceId };
