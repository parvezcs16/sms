const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('jszip');
const config = require('../config');

// VACUUM INTO writes a consistent snapshot that includes everything still
// sitting in the -wal file. A plain file copy of sms.db (what this used to do)
// silently misses any recent writes that haven't been checkpointed yet.
function snapshotTo(destPath) {
  const { getDb } = require('../db/connection');
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  getDb().prepare('VACUUM INTO ?').run(destPath);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createBackup(prefix = 'sms-backup') {
  const fileName = `${prefix}-${stamp()}.db`;
  const destPath = path.join(config.backupsDir, fileName);
  snapshotTo(destPath);
  const stats = fs.statSync(destPath);
  return { fileName, sizeBytes: stats.size, path: destPath };
}

function listBackups() {
  if (!fs.existsSync(config.backupsDir)) return [];
  return fs.readdirSync(config.backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const stats = fs.statSync(path.join(config.backupsDir, f));
      return { fileName: f, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupFilePath(fileName) {
  const safeName = path.basename(fileName);
  const fullPath = path.join(config.backupsDir, safeName);
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

// Confirms a file really is a (healthy) CHAND school database before we let
// it replace the live one.
function inspectDatabaseFile(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    const integrity = db.prepare('PRAGMA quick_check').get();
    const ok = integrity && Object.values(integrity)[0] === 'ok';
    if (!ok) throw new Error('The backup file is damaged (integrity check failed)');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const required of ['users', 'students', 'settings']) {
      if (!tables.has(required)) throw new Error('This file is not a CHAND School Management backup');
    }
    const count = (t) => (tables.has(t) ? db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c : 0);
    const schemaVersion = tables.has('schema_migrations') ? (db.prepare('SELECT MAX(id) AS v FROM schema_migrations').get().v || 0) : 0;
    const schoolRow = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
    return {
      schoolName: schoolRow ? schoolRow.value : '',
      students: count('students'),
      teachers: count('teachers'),
      staff: count('staff'),
      invoices: count('fee_invoices'),
      schemaVersion
    };
  } catch (err) {
    if (/file is not a database|malformed/i.test(err.message)) throw new Error('This file is not a valid database backup');
    throw err;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

// Replaces the live database with `sourcePath` safely:
//  1. snapshot the current data (pre-restore-*.db) so the restore can be undone,
//  2. close the open connection, swap the file, drop stale WAL/SHM files,
//  3. reopen and run migrations, so an older backup is brought up to date,
//  4. keep THIS PC's license activation (a backup from another PC would
//     otherwise carry that PC's key and lock the app).
// No app restart is needed afterwards.
function restoreFromFile(sourcePath) {
  const info = inspectDatabaseFile(sourcePath);
  const { getDb, closeDb } = require('../db/connection');
  const { ensureSchema } = require('../db/schema');
  const { runMigrations } = require('../db/migrations');

  const live = getDb();
  const keep = live.prepare("SELECT key, value FROM settings WHERE key IN ('license.key', 'license.activatedAt')").all();
  const preRestore = path.join(config.backupsDir, `pre-restore-${stamp()}.db`);
  snapshotTo(preRestore);

  const staged = `${config.dbPath}.restoring`;
  fs.copyFileSync(sourcePath, staged);
  closeDb();
  try {
    for (const ext of ['-wal', '-shm']) {
      const sidecar = `${config.dbPath}${ext}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
    fs.renameSync(staged, config.dbPath);
  } catch (err) {
    // Put the previous data back if the swap failed half-way.
    fs.copyFileSync(preRestore, config.dbPath);
    throw err;
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }

  const db = getDb();
  ensureSchema(db);
  runMigrations(db);
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  keep.forEach((row) => upsert.run(row.key, row.value));
  return { ...info, preRestoreBackup: path.basename(preRestore) };
}

function restoreBackup(fileName) {
  const source = backupFilePath(fileName);
  if (!source) throw new Error('Backup file not found');
  return restoreFromFile(source);
}

// Full backup = database snapshot + every uploaded photo/document/logo, in one
// .zip that can be kept on a USB drive / Google Drive and restored on any PC.
async function buildFullBackupZip() {
  const tmp = path.join(config.backupsDir, `full-${stamp()}.tmp.db`);
  snapshotTo(tmp);
  try {
    const zip = new JSZip();
    zip.file('sms.db', fs.readFileSync(tmp));
    zip.file('backup-info.json', JSON.stringify({ app: 'chand-sms', version: config.appVersion, createdAt: new Date().toISOString() }, null, 2));
    if (fs.existsSync(config.uploadsDir)) {
      for (const name of fs.readdirSync(config.uploadsDir)) {
        const full = path.join(config.uploadsDir, name);
        if (fs.statSync(full).isFile()) zip.file(`uploads/${name}`, fs.readFileSync(full));
      }
    }
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

// Turns an uploaded .db or .zip into a .db saved in backups/ (and, for a zip,
// restores its photos/documents into uploads/ — existing files are kept).
async function importUploadedBackup(uploadPath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const fileName = `uploaded-${stamp()}.db`;
  const dest = path.join(config.backupsDir, fileName);
  let restoredUploads = 0;
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(fs.readFileSync(uploadPath));
    const dbEntry = zip.file('sms.db') || zip.file(/\.db$/i)[0];
    if (!dbEntry) throw new Error('No database (sms.db) found inside this zip');
    fs.writeFileSync(dest, await dbEntry.async('nodebuffer'));
    try {
      inspectDatabaseFile(dest);
    } catch (err) {
      fs.unlinkSync(dest);
      throw err;
    }
    const uploads = zip.file(/^uploads\/[^/]+$/);
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    for (const entry of uploads) {
      const name = path.basename(entry.name);
      if (!name || name.startsWith('.')) continue;
      const target = path.join(config.uploadsDir, name);
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, await entry.async('nodebuffer'));
        restoredUploads += 1;
      }
    }
  } else if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
    fs.copyFileSync(uploadPath, dest);
    try {
      inspectDatabaseFile(dest);
    } catch (err) {
      fs.unlinkSync(dest);
      throw err;
    }
  } else {
    throw new Error('Choose a .zip (full backup) or .db backup file');
  }
  return { fileName, path: dest, restoredUploads, info: inspectDatabaseFile(dest) };
}

module.exports = {
  createBackup, listBackups, backupFilePath, restoreBackup, restoreFromFile,
  inspectDatabaseFile, buildFullBackupZip, importUploadedBackup
};
