const path = require('path');
const fs = require('fs');

// __dirname is 2 levels below repo root at server/src/config.js when run from
// source, but only 1 level below when run from the bundled server-dist/server.js
// (esbuild collapses everything to a single file, so __dirname becomes the
// bundle's own directory). Pick whichever candidate actually has a sibling
// `client/` folder (a marker only the true repo root has) so this resolves
// correctly in both layouts. Every candidate directory technically "exists",
// so a plain fs.existsSync(candidate) check can't distinguish them.
function resolveRepoRoot() {
  const candidates = [
    path.join(__dirname, '..'),      // bundled: server-dist/..
    path.join(__dirname, '..', '..') // source: server/src/../..
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'client'))) || candidates[0];
}

const repoRoot = resolveRepoRoot();

function resolveUserDataDir() {
  // When launched inside Electron, main.js sets SMS_DATA_DIR to app.getPath('userData').
  // Falls back to a local .data directory for `npm run dev` / plain `node server.js`.
  if (process.env.SMS_DATA_DIR) return process.env.SMS_DATA_DIR;
  return path.join(repoRoot, '.data');
}

const dataDir = resolveUserDataDir();
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });

function resolveAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

module.exports = {
  appVersion: resolveAppVersion(),
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || path.join(dataDir, 'sms.db'),
  dataDir,
  repoRoot,
  codeDir: __dirname,
  uploadsDir: path.join(dataDir, 'uploads'),
  backupsDir: path.join(dataDir, 'backups'),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  clientDist: process.env.SMS_CLIENT_DIST || path.join(repoRoot, 'client', 'dist'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'School Management System <no-reply@school.local>'
  },
  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    fromSms: process.env.TWILIO_FROM_SMS || ''
  },
  license: {
    // See server/src/utils/licenseSecret.js — kept in its own file so the
    // standalone License Admin exe can use it without loading this config
    // (which creates data folders on import).
    signingSecret: require('./utils/licenseSecret').signingSecret
  }
};
