const fs = require('fs');
const path = require('path');
const config = require('../config');

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// School stamps (Settings → School Branding → Stamps). Each kind is an
// uploaded or generated PNG saved as setting `stamp_<kind>`; `stamp_usage`
// says which stamp is printed on which document ('' = none).
const STAMP_KINDS = ['official', 'principal', 'paid', 'approved'];
const STAMP_DOCS = ['certificates', 'result_cards', 'progress_reports', 'fee_receipts', 'payslips', 'notices'];
const DEFAULT_STAMP_USAGE = {
  certificates: 'official', result_cards: 'official', progress_reports: 'official',
  fee_receipts: 'paid', payslips: 'principal', notices: 'official'
};

function stampUsage(db) {
  let saved = {};
  try { saved = JSON.parse(getSetting(db, 'stamp_usage', '') || '{}') || {}; } catch { saved = {}; }
  const out = {};
  STAMP_DOCS.forEach((d) => {
    const v = Object.prototype.hasOwnProperty.call(saved, d) ? saved[d] : DEFAULT_STAMP_USAGE[d];
    out[d] = STAMP_KINDS.includes(v) ? v : '';
  });
  return out;
}

// Absolute path of the stamp to print on `docKind`, or null when none is
// chosen / uploaded / the file is missing.
function stampPathFor(db, docKind) {
  if (!docKind) return null;
  const kind = stampUsage(db)[docKind];
  if (!kind) return null;
  const file = getSetting(db, `stamp_${kind}`, '');
  if (!file) return null;
  const p = path.join(config.uploadsDir, path.basename(file));
  return fs.existsSync(p) ? p : null;
}

// Used by every PDF generator (payslip, receipt, voucher, notice) for a consistent letterhead.
// Pass `docKind` (e.g. 'fee_receipts') to also get the stamp chosen for it.
function getBranding(db, docKind) {
  const schoolName = getSetting(db, 'school_name', 'CHAND School Management System');
  const logoFile = getSetting(db, 'school_logo', '');
  const logoPath = logoFile ? path.join(config.uploadsDir, logoFile) : null;
  return { schoolName, logoPath, contact: schoolContactLine(db), stampPath: stampPathFor(db, docKind) };
}

// Colour of the school name on the dashboard and on every printed letterhead.
function schoolNameColor(db, fallback = '#1d4ed8') {
  const c = String(getSetting(db, 'school_name_color', '') || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

// "Address · Ph: 0300-1234567" under the school name on letterheads and
// vouchers. (Older copies saved the address as school_address.)
function schoolContactLine(db) {
  const address = (getSetting(db, 'address', '') || getSetting(db, 'school_address', '')).replace(/\s*\n\s*/g, ', ').trim();
  const phone = getSetting(db, 'school_phone', '').trim();
  return [address, phone && `Ph: ${phone}`].filter(Boolean).join('  ·  ');
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getAllSettings(db) {
  // license.* rows are internal activation state, not app settings — keep them
  // out of this endpoint, which any authenticated role (including parent/student) can read.
  // Google Drive credentials never leave the server.
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'license.%' AND key NOT IN ('gdrive_client_secret', 'gdrive_refresh_token')").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

module.exports = { schoolNameColor, getSetting, setSetting, getAllSettings, getBranding, schoolContactLine, stampUsage, stampPathFor, STAMP_KINDS, STAMP_DOCS };
