// Local, private record of every key you've issued — used by
// scripts/generate-license.js, scripts/license-admin-page.js and the
// "CHAND License Admin" exe so they share one source of truth. Nothing here is
// sent anywhere; it's purely your own bookkeeping (school name, device id, key,
// issued date, and a status you set by hand once a school confirms activation
// worked — there's no way to detect that automatically, since the app never
// phones home).
//
// Location: %APPDATA%\CHAND License Admin\licenses-issued.json for every
// entry point (exe, CLI, .bat). SMS_LICENSE_REGISTRY overrides it (tests).
// The old repo-root licenses-issued.json is copied in once on first use.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const APPDATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'CHAND License Admin');
const DEFAULT_FILE = path.join(APPDATA_DIR, 'licenses-issued.json');
const LEGACY_FILE = path.join(__dirname, '..', '..', 'licenses-issued.json');

function registryFile() {
  return process.env.SMS_LICENSE_REGISTRY || DEFAULT_FILE;
}

// One-time move of the old project-folder list into APPDATA.
function migrateLegacy(file) {
  if (fs.existsSync(file) || process.env.SMS_LICENSE_REGISTRY) return;
  const sources = [LEGACY_FILE, process.env.SMS_LICENSE_LEGACY].filter(Boolean);
  const src = sources.find((f) => fs.existsSync(f));
  if (!src) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(src, file);
  } catch {
    // leave it; the exe still offers a manual import
  }
}

function readAll() {
  const file = registryFile();
  migrateLegacy(file);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

// Write to a temp file then rename, so a crash mid-write can never leave a
// half-written (corrupt) registry behind.
function writeAll(records) {
  const file = registryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, file);
}

function issue({ schoolName, deviceId, key, issuedBy = null }) {
  const records = readAll();
  const record = {
    id: crypto.randomUUID(),
    schoolName,
    deviceId,
    key,
    issuedBy,
    issuedAt: new Date().toISOString(),
    status: 'issued', // 'issued' | 'confirmed'
    confirmedAt: null
  };
  records.unshift(record);
  writeAll(records);
  return record;
}

function markConfirmed(id) {
  const records = readAll();
  const record = records.find((r) => r.id === id);
  if (!record) return null;
  record.status = 'confirmed';
  record.confirmedAt = new Date().toISOString();
  writeAll(records);
  return record;
}

// Merges records from another licenses-issued.json (e.g. the one the CLI kept
// in the repo) without creating duplicates. Returns how many were added.
function importFrom(otherFile) {
  const incoming = JSON.parse(fs.readFileSync(otherFile, 'utf8'));
  if (!Array.isArray(incoming)) throw new Error('That file is not a licenses list.');
  const records = readAll();
  const seen = new Set(records.map((r) => r.id));
  const seenPair = new Set(records.map((r) => `${r.deviceId}|${r.key}`));
  let added = 0;
  for (const r of incoming) {
    if (!r || !r.key || !r.deviceId) continue;
    if (seen.has(r.id) || seenPair.has(`${r.deviceId}|${r.key}`)) continue;
    records.push({ ...r, id: r.id || crypto.randomUUID() });
    added += 1;
  }
  records.sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  if (added) writeAll(records);
  return added;
}

module.exports = {
  get REGISTRY_FILE() { return registryFile(); },
  registryFile,
  readAll,
  issue,
  markConfirmed,
  importFrom
};
