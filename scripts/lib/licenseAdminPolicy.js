// Who may issue license keys, and how many.
//
// License Admin only runs on the PCs listed below (identified by the same
// Device ID the school app shows). Each PC has its own issue limit; null means
// unlimited (the developer's own PC). The limit counts keys issued ON that PC.
// Re-issuing a key for a Device ID that already has one returns the existing
// key and does not use up the limit.
//
// The count is the larger of (a) records in the registry issued by this PC and
// (b) a signed usage counter kept in a separate file, so deleting or editing
// the registry does not reset the limit.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { getDeviceId } = require('../../server/src/utils/fingerprint');
const { normalize, formatGroups, deriveLicenseKey } = require('../../server/src/utils/licenseKey');
const { signingSecret } = require('../../server/src/utils/licenseSecret');
const registry = require('./licenseRegistry');

const ALLOWED_PCS = {
  Q04FMBJJYH3G: null, // developer's PC: unlimited
  GHRMT145PV50: 20,
  BK03XS86Y3XG: 20
};

class PolicyError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

function thisPcId() {
  return normalize(getDeviceId());
}

function limitFor(pcId) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_PCS, pcId) ? ALLOWED_PCS[pcId] : undefined;
}

function assertAllowedPc() {
  const pc = thisPcId();
  if (limitFor(pc) === undefined) {
    throw new PolicyError(`License Admin is not authorised to run on this PC (Device ID ${formatGroups(pc, 4)}).`);
  }
  return pc;
}

// ---- signed usage counter --------------------------------------------------

function counterFile() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'CHAND License Admin', '.usage');
}

function sign(pc, count) {
  return crypto.createHmac('sha256', signingSecret).update(`usage|${pc}|${count}`).digest('hex');
}

function readCounter(pc) {
  try {
    const data = JSON.parse(fs.readFileSync(counterFile(), 'utf8'));
    if (data && data.pc === pc && Number.isInteger(data.count) && data.sig === sign(pc, data.count)) return data.count;
  } catch {
    // missing or unreadable: fall back to the registry count
  }
  return 0;
}

function writeCounter(pc, count) {
  const file = counterFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pc, count, sig: sign(pc, count) }));
  fs.renameSync(tmp, file);
}

function usedCount(pc, records = registry.readAll()) {
  // Records without issuedBy predate this rule (or were imported from the
  // developer's list) and do not count.
  const fromRegistry = records.filter((r) => r.issuedBy === pc).length;
  return Math.max(fromRegistry, readCounter(pc));
}

// ---- issuing ----------------------------------------------------------------

function issueKey({ schoolName, deviceId: rawDeviceId }) {
  const pc = assertAllowedPc();
  if (!schoolName || !rawDeviceId) throw new PolicyError('School name and Device ID are both required.', 400);
  const deviceId = normalize(rawDeviceId);
  if (deviceId.length < 8) throw new PolicyError("That doesn't look like a valid Device ID.", 400);

  const key = formatGroups(deriveLicenseKey(deviceId, signingSecret), 4);
  const records = registry.readAll();
  const existing = records.find((r) => r.deviceId === deviceId);
  if (existing) return { key, record: existing, reused: true };

  const limit = limitFor(pc);
  const used = usedCount(pc, records);
  if (limit !== null && used >= limit) {
    throw new PolicyError(`License limit reached: this PC can issue at most ${limit} keys.`);
  }
  const record = registry.issue({ schoolName, deviceId, key, issuedBy: pc });
  if (limit !== null) writeCounter(pc, used + 1);
  return { key, record, reused: false };
}

module.exports = { PolicyError, assertAllowedPc, issueKey, thisPcId };
