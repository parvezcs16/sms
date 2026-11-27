const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { getAllSettings, getSetting, setSetting, stampUsage, STAMP_KINDS, STAMP_DOCS } = require('../services/settings');
const backupService = require('../services/backup');
const qrService = require('../services/qrcode');
const whatsappService = require('../services/notifications/whatsappService');
const { getSchemaVersion } = require('../db/migrations');
const { upload } = require('../middleware/upload');
const config = require('../config');
const { getLanAddresses } = require('../services/lan');
const multer = require('multer');
const { localDateStr } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);

router.get('/version', asyncHandler(async (req, res) => {
  res.json({ appVersion: config.appVersion, schemaVersion: getSchemaVersion(getDb()) });
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json(getAllSettings(getDb()));
}));

router.put('/', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  Object.entries(req.body || {}).forEach(([key, value]) => setSetting(db, key, value));
  recordAudit(req, 'update_settings', 'settings', null, req.body);
  res.json({ success: true });
}));

router.post('/logo', requireAccess('settings', 'manage'), upload.single('logo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'logo file is required');
  const db = getDb();
  const previous = getSetting(db, 'school_logo', '');
  if (previous) {
    const previousPath = path.join(config.uploadsDir, previous);
    if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
  }
  setSetting(db, 'school_logo', req.file.filename);
  recordAudit(req, 'update_logo', 'settings', null);
  res.status(201).json({ success: true, file: req.file.filename });
}));

// School building / campus picture shown in the dashboard banner.
function removeUploadFile(f) {
  if (!f) return;
  const p = path.join(config.uploadsDir, path.basename(f));
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
}

router.post('/school-picture', requireAccess('settings', 'manage'), upload.single('picture'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a picture to upload');
  if (!/\.(jpe?g|png|gif|webp)$/i.test(req.file.originalname)) {
    removeUploadFile(req.file.filename);
    throw new HttpError(400, 'Please choose an image (JPG, PNG, WEBP).');
  }
  const db = getDb();
  const previous = getSetting(db, 'school_picture', '');
  setSetting(db, 'school_picture', req.file.filename);
  removeUploadFile(previous);
  recordAudit(req, 'update_school_picture', 'settings', null);
  res.status(201).json({ success: true, file: req.file.filename });
}));

router.delete('/school-picture', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const previous = getSetting(db, 'school_picture', '');
  setSetting(db, 'school_picture', '');
  removeUploadFile(previous);
  recordAudit(req, 'remove_school_picture', 'settings', null);
  res.json({ success: true });
}));

// ---- WhatsApp (Baileys — free, direct, no share-sheet) ----
// ---- School stamps ----
// PDFs embed these, and PDFKit reads only PNG/JPEG — so no WEBP/GIF here.
router.get('/stamps', asyncHandler(async (req, res) => {
  const db = getDb();
  const stamps = Object.fromEntries(STAMP_KINDS.map((k) => [k, getSetting(db, `stamp_${k}`, '') || null]));
  res.json({ kinds: STAMP_KINDS, docs: STAMP_DOCS, stamps, usage: stampUsage(db) });
}));

router.put('/stamps/usage', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const clean = {};
  STAMP_DOCS.forEach((d) => {
    const v = body[d] == null ? '' : String(body[d]);
    if (v && !STAMP_KINDS.includes(v)) throw new HttpError(400, `Unknown stamp "${v}"`);
    clean[d] = v;
  });
  const db = getDb();
  setSetting(db, 'stamp_usage', JSON.stringify(clean));
  recordAudit(req, 'update_stamp_usage', 'settings', null, clean);
  res.json({ success: true, usage: stampUsage(db) });
}));

router.post('/stamps/:kind', requireAccess('settings', 'manage'), upload.single('stamp'), asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!STAMP_KINDS.includes(kind)) {
    if (req.file) removeUploadFile(req.file.filename);
    throw new HttpError(400, 'Unknown stamp type');
  }
  if (!req.file) throw new HttpError(400, 'Choose a stamp image to upload');
  if (!/\.(jpe?g|png)$/i.test(req.file.originalname)) {
    removeUploadFile(req.file.filename);
    throw new HttpError(400, 'Please choose a PNG or JPG image (a PNG with a transparent background looks best).');
  }
  const db = getDb();
  const previous = getSetting(db, `stamp_${kind}`, '');
  setSetting(db, `stamp_${kind}`, req.file.filename);
  removeUploadFile(previous);
  recordAudit(req, 'update_stamp', 'settings', null, { kind });
  res.status(201).json({ success: true, file: req.file.filename });
}));

router.delete('/stamps/:kind', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!STAMP_KINDS.includes(kind)) throw new HttpError(400, 'Unknown stamp type');
  const db = getDb();
  const previous = getSetting(db, `stamp_${kind}`, '');
  setSetting(db, `stamp_${kind}`, '');
  removeUploadFile(previous);
  recordAudit(req, 'remove_stamp', 'settings', null, { kind });
  res.json({ success: true });
}));

router.get('/whatsapp/status', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const status = whatsappService.getStatus();
  const qrDataUrl = status.status === 'qr' ? await whatsappService.getQrDataUrl() : null;
  res.json({ ...status, qrDataUrl });
}));

router.post('/whatsapp/connect', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  whatsappService.connect().catch(() => {});
  recordAudit(req, 'connect_whatsapp', 'settings', null);
  res.json({ success: true });
}));

router.post('/whatsapp/logout', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  await whatsappService.logout();
  recordAudit(req, 'logout_whatsapp', 'settings', null);
  res.json({ success: true });
}));

router.get('/lan-info', asyncHandler(async (req, res) => {
  const adapters = getLanAddresses();
  const urls = await Promise.all(adapters.map(async (a) => {
    const url = `http://${a.address}:${config.port}/attendance`;
    return { adapter: a.name, address: a.address, recommended: a.score >= 0, url, qrDataUrl: await qrService.lanUrlQrDataUrl(url) };
  }));
  const primary = urls[0] || null;
  res.json({
    hostname: os.hostname(),
    addresses: adapters.map((a) => a.address),
    port: config.port,
    attendanceUrl: primary ? primary.url : null,
    qrDataUrl: primary ? primary.qrDataUrl : null,
    serverUrl: primary ? `http://${primary.address}:${config.port}` : null,
    options: urls
  });
}));

router.get('/audit-logs', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { entity_type = '', username = '', action = '', from = '', to = '', search = '', page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const where = `(@entity_type = '' OR entity_type = @entity_type) AND (@username = '' OR username = @username)
    AND (@action = '' OR action = @action) AND (@from = '' OR date(created_at, 'localtime') >= @from) AND (@to = '' OR date(created_at, 'localtime') <= @to)
    AND (@search = '' OR details_json LIKE @q OR entity_type LIKE @q OR action LIKE @q)`;
  const p = { entity_type, username, action, from, to, search, q: `%${search}%` };
  const rows = db.prepare(
    `SELECT *, datetime(created_at, 'localtime') AS local_time FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: Number(limit), offset });
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE ${where}`).get(p).c;
  const facets = {
    users: db.prepare('SELECT DISTINCT username FROM audit_logs WHERE username IS NOT NULL ORDER BY username').all().map((r) => r.username),
    actions: db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map((r) => r.action),
    entities: db.prepare('SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type').all().map((r) => r.entity_type)
  };
  res.json({ rows, pagination: { page: Number(page), limit: Number(limit), total }, facets });
}));

router.get('/backups', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json(backupService.listBackups());
}));

router.post('/backups', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const backup = backupService.createBackup();
  db.prepare('INSERT INTO backups_log (file_name, size_bytes, created_by) VALUES (?, ?, ?)').run(backup.fileName, backup.sizeBytes, req.user.id);
  recordAudit(req, 'create_backup', 'backup', null, { fileName: backup.fileName });
  res.status(201).json(backup);
}));

router.get('/backups/:fileName/download', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const filePath = backupService.backupFilePath(req.params.fileName);
  if (!filePath) throw new HttpError(404, 'Backup not found');
  res.download(filePath);
}));

router.post('/backups/:fileName/restore', requireRole('super_admin'), asyncHandler(async (req, res) => {
  let result;
  try {
    result = backupService.restoreBackup(req.params.fileName);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  recordAudit(req, 'restore_backup', 'backup', null, { fileName: req.params.fileName, preRestoreBackup: result.preRestoreBackup });
  res.json({
    success: true,
    ...result,
    message: `Backup restored (${result.students} students, ${result.teachers} teachers). Your previous data was saved as ${result.preRestoreBackup}.`
  });
}));

// Full backup (.zip = database + photos/documents) to keep outside this PC.
router.get('/backups/full.zip', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const buffer = await backupService.buildFullBackupZip();
  const name = `CHAND-full-backup-${localDateStr()}.zip`;
  recordAudit(req, 'download_full_backup', 'backup', null, { sizeBytes: buffer.length });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buffer);
}));

// Upload a backup from outside (USB drive, Google Drive, another PC): a full
// backup .zip or a plain .db. It is checked, saved into the backups list, and
// restored straight away when restore=true.
const backupUpload = multer({
  dest: path.join(config.backupsDir, 'incoming'),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(zip|db|sqlite3?)$/i.test(file.originalname))
});

router.post('/backups/upload', requireRole('super_admin'), backupUpload.single('backup'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a .zip or .db backup file');
  let imported;
  try {
    imported = await backupService.importUploadedBackup(req.file.path, req.file.originalname);
  } catch (err) {
    throw new HttpError(400, err.message);
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
  recordAudit(req, 'upload_backup', 'backup', null, { fileName: imported.fileName, original: req.file.originalname });
  if (String(req.body.restore) !== 'true') {
    return res.status(201).json({ success: true, fileName: imported.fileName, info: imported.info, restoredUploads: imported.restoredUploads });
  }
  let result;
  try {
    result = backupService.restoreBackup(imported.fileName);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  recordAudit(req, 'restore_backup', 'backup', null, { fileName: imported.fileName, preRestoreBackup: result.preRestoreBackup, source: 'upload' });
  res.json({
    success: true,
    restored: true,
    ...result,
    restoredUploads: imported.restoredUploads,
    message: `Restored ${req.file.originalname}: ${result.students} students, ${result.teachers} teachers${imported.restoredUploads ? `, ${imported.restoredUploads} photos/documents` : ''}. Previous data saved as ${result.preRestoreBackup}.`
  });
}));

// ---- Automatic local backups + Google Drive ----
const cloudBackup = require('../services/cloudBackup');

router.get('/cloud-backup', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json({ ...cloudBackup.settings(), redirect_uri: cloudBackup.redirectUri() });
}));

router.put('/cloud-backup', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const TIME = /^\d{2}:\d{2}$/;
  const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  if (b.mode !== undefined) { if (!['', 'folder', 'api'].includes(b.mode)) throw new HttpError(400, 'Unknown backup method'); set('gdrive_mode', b.mode); }
  if (b.folder_path !== undefined) set('gdrive_folder_path', String(b.folder_path).trim());
  if (b.client_id !== undefined) {
    const id = String(b.client_id).trim();
    if (id !== getSetting(db, 'gdrive_client_id', '')) cloudBackup.disconnect(db); // a token only works with the client that issued it
    set('gdrive_client_id', id);
  }
  if (b.client_secret) set('gdrive_client_secret', String(b.client_secret).trim());
  if (b.frequency !== undefined) {
    if (!cloudBackup.FREQUENCIES.includes(b.frequency)) throw new HttpError(400, 'Choose daily, weekly, monthly or only when I tap Back up');
    set('gdrive_frequency', b.frequency);
    set('gdrive_retry_at', '');
  } else if (b.auto !== undefined) set('gdrive_frequency', b.auto ? 'daily' : 'manual');
  if (b.time !== undefined) { if (!TIME.test(b.time)) throw new HttpError(400, 'Time must be HH:MM'); set('gdrive_time', b.time); }
  if (b.keep !== undefined) { if (!(Number(b.keep) >= 1)) throw new HttpError(400, 'Keep at least 1 backup'); set('gdrive_keep', Math.round(Number(b.keep))); }
  if (b.local_auto !== undefined) set('local_backup_auto', b.local_auto ? 'true' : 'false');
  if (b.local_time !== undefined) { if (!TIME.test(b.local_time)) throw new HttpError(400, 'Time must be HH:MM'); set('local_backup_time', b.local_time); }
  if (b.local_keep !== undefined) { if (!(Number(b.local_keep) >= 1)) throw new HttpError(400, 'Keep at least 1 backup'); set('local_backup_keep', Math.round(Number(b.local_keep))); }
  recordAudit(req, 'update', 'cloud_backup_settings', null, { ...b, client_secret: b.client_secret ? '***' : undefined });
  res.json(cloudBackup.settings());
}));

router.get('/gdrive/folders', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const fs = require('fs');
  const pathMod = require('path');
  const found = [];
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [];
  for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') candidates.push(`${l}:\My Drive`, `${l}:\Shared drives`);
  candidates.push(pathMod.join(home, 'Google Drive'), pathMod.join(home, 'My Drive'), pathMod.join(home, 'Google Drive', 'My Drive'));
  for (const c of candidates) { try { if (fs.existsSync(c)) found.push(c); } catch { /* ignore */ } }
  res.json(found);
}));

router.get('/gdrive/auth-url', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  try { res.json({ url: cloudBackup.authUrl(), redirect_uri: cloudBackup.redirectUri() }); } catch (err) { throw new HttpError(err.status || 500, err.message); }
}));

router.post('/gdrive/disconnect', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  cloudBackup.disconnect(getDb());
  recordAudit(req, 'disconnect', 'google_drive');
  res.json({ success: true });
}));

router.post('/gdrive/backup-now', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  try {
    const r = await cloudBackup.backupToDrive({ trigger: 'manual' });
    recordAudit(req, 'backup_to_drive', 'backup', null, r);
    res.json(r);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}));

// Backups already in Google Drive — from this PC or an earlier install on the
// same Google account — and restoring one (like WhatsApp's Restore).
router.get('/gdrive/backups', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  try { res.json(await cloudBackup.listDriveBackups()); } catch (err) { throw new HttpError(400, err.message); }
}));

router.post('/gdrive/restore', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const id = String((req.body || {}).id || '');
  if (!id) throw new HttpError(400, 'Choose a backup to restore');
  let result;
  try { result = await cloudBackup.restoreFromDrive(id); } catch (err) { throw new HttpError(400, err.message); }
  recordAudit(req, 'restore_backup', 'backup', null, { source: 'google_drive', id, preRestoreBackup: result.preRestoreBackup });
  res.json({
    success: true, ...result,
    message: `Restored from Google Drive: ${result.students} students, ${result.teachers} teachers${result.restoredUploads ? `, ${result.restoredUploads} photos/documents` : ''}. Previous data saved as ${result.preRestoreBackup}.`
  });
}));

router.post('/backups/auto-now', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const b = cloudBackup.localAutoBackup();
  recordAudit(req, 'create_backup', 'backup', null, { fileName: b.fileName });
  res.status(201).json(b);
}));

module.exports = router;
