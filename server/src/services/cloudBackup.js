// Off-site backups to Google Drive — works like WhatsApp chat backup:
// connect a Google account once, then the app backs up by itself (daily /
// weekly / monthly) and any PC signed in to the same account can restore.
//
// Two ways to reach Google Drive:
//  1. "api" (default) — the app uploads straight to the school's Google
//     account. The app's own Google sign-in ("built-in client", see
//     builtInClient()) means the school only clicks Connect and picks an
//     account. A school may also use its own OAuth client instead.
//     Files go into a "CHAND School Backups" folder; the app can only see the
//     files it created (drive.file scope), never the rest of the Drive.
//  2. "folder" — Google Drive for desktop syncs a folder (e.g. G:\My Drive);
//     the backup .zip is saved there and Google Drive uploads it.
//
// Local backups (backups/ folder) keep running either way.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db/connection');
const { getSetting, setSetting } = require('./settings');
const backupService = require('./backup');
const { localDateTimeStr } = require('../utils/people');
const { localDateStr } = require('../utils/localDate');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'CHAND School Backups';
const FILE_RE = /^CHAND-backup-.*\.zip$/;
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'manual'];
const pendingStates = new Map(); // state -> { exp, verifier }

// The app's own Google OAuth "Desktop app" client, shipped with the installer
// as google-oauth.json (the file Google Cloud Console downloads), or given as
// CHAND_GDRIVE_CLIENT_ID / CHAND_GDRIVE_CLIENT_SECRET. Google treats a desktop
// app's client secret as not confidential, and PKCE protects each sign-in.
let builtInCache;
function builtInClient() {
  if (builtInCache !== undefined) return builtInCache;
  builtInCache = null;
  if (process.env.CHAND_GDRIVE_CLIENT_ID) {
    builtInCache = { client_id: process.env.CHAND_GDRIVE_CLIENT_ID, client_secret: process.env.CHAND_GDRIVE_CLIENT_SECRET || '' };
    return builtInCache;
  }
  const places = [config.dataDir, config.codeDir, path.join(config.codeDir, '..'), config.repoRoot].filter(Boolean);
  for (const dir of places) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'google-oauth.json'), 'utf8'));
      const c = raw.installed || raw.web || raw;
      if (c.client_id) { builtInCache = { client_id: c.client_id, client_secret: c.client_secret || '' }; break; }
    } catch { /* not here */ }
  }
  return builtInCache;
}
function resetBuiltInCache() { builtInCache = undefined; }

// The school's own client (Settings → advanced) wins over the built-in one.
function credentials(db) {
  const own = getSetting(db, 'gdrive_client_id', '');
  if (own) return { client_id: own, client_secret: getSetting(db, 'gdrive_client_secret', ''), own: true };
  const b = builtInClient();
  return b ? { ...b, own: false } : null;
}

function frequency(db) {
  const f = getSetting(db, 'gdrive_frequency', '');
  if (FREQUENCIES.includes(f)) return f;
  return getSetting(db, 'gdrive_auto', 'false') === 'true' ? 'daily' : 'manual'; // older setting
}

function settings(db = getDb()) {
  const g = (k, d = '') => getSetting(db, k, d);
  const creds = credentials(db);
  return {
    mode: g('gdrive_mode'),
    folder_path: g('gdrive_folder_path'),
    client_id: g('gdrive_client_id'),
    has_secret: Boolean(g('gdrive_client_secret')),
    built_in: Boolean(builtInClient()),
    can_connect: Boolean(creds),
    connected: Boolean(g('gdrive_refresh_token')),
    account: g('gdrive_account'),
    connected_at: g('gdrive_connected_at'),
    frequency: frequency(db),
    auto: frequency(db) !== 'manual',
    time: g('gdrive_time') || '20:00',
    keep: Number(g('gdrive_keep', '30')) || 30,
    local_auto: g('local_backup_auto', 'true') === 'true',
    local_time: g('local_backup_time') || '18:00',
    local_keep: Number(g('local_backup_keep', '30')) || 30,
    last: (() => { try { return JSON.parse(g('gdrive_last', 'null')); } catch { return null; } })(),
    last_ok: (() => { try { return JSON.parse(g('gdrive_last_ok', 'null')); } catch { return null; } })(),
    last_local: g('local_backup_last', '')
  };
}

function redirectUri() {
  return `http://127.0.0.1:${config.port}/api/gdrive/callback`;
}

function authUrl(db = getDb()) {
  const creds = credentials(db);
  if (!creds) throw Object.assign(new Error('Google sign-in is not set up in this copy of the app — use “Google Drive for desktop”, or enter your own Google client ID under Advanced'), { status: 400 });
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  for (const [k, v] of pendingStates) if (v.exp < Date.now()) pendingStates.delete(k);
  pendingStates.set(state, { exp: Date.now() + 15 * 60000, verifier });
  const q = new URLSearchParams({
    client_id: creds.client_id, redirect_uri: redirectUri(), response_type: 'code', scope: `${SCOPE} openid email`,
    access_type: 'offline', prompt: 'consent select_account', state,
    code_challenge: challenge, code_challenge_method: 'S256'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const body = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (out.error === 'invalid_grant') throw Object.assign(new Error('Google access was removed or expired — connect the Google account again in Backup & Restore'), { reconnect: true });
    throw new Error(out.error_description || out.error || `Google sign-in failed (${r.status})`);
  }
  return out;
}

async function handleCallback({ code, state, error }) {
  if (error) throw new Error(error === 'access_denied' ? 'Sign-in was cancelled' : `Google said: ${error}`);
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.exp < Date.now()) throw new Error('This sign-in link has expired — start again from Settings');
  const db = getDb();
  const creds = credentials(db);
  if (!creds) throw new Error('Google sign-in is not set up');
  const tok = await tokenRequest({
    code, client_id: creds.client_id, client_secret: creds.client_secret, code_verifier: pending.verifier,
    redirect_uri: redirectUri(), grant_type: 'authorization_code'
  });
  if (!tok.refresh_token) throw new Error('Google did not return a long-term token — remove the app from your Google account permissions and connect again');
  setSetting(db, 'gdrive_refresh_token', tok.refresh_token);
  let account = '';
  try {
    const payload = JSON.parse(Buffer.from(String(tok.id_token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    account = payload.email || '';
  } catch { /* no email */ }
  setSetting(db, 'gdrive_account', account);
  setSetting(db, 'gdrive_folder_id', '');
  setSetting(db, 'gdrive_connected_at', localDateTimeStr());
  setSetting(db, 'gdrive_mode', 'api');
  // Like WhatsApp: once an account is connected, back up daily unless the
  // school already chose something else, and take the first backup now.
  if (!FREQUENCIES.includes(getSetting(db, 'gdrive_frequency', ''))) setSetting(db, 'gdrive_frequency', 'daily');
  setSetting(db, 'gdrive_retry_at', '');
  backupToDrive({ trigger: 'first backup' }).catch(() => { /* shown in Settings */ });
  return { account };
}

function disconnect(db = getDb()) {
  for (const k of ['gdrive_refresh_token', 'gdrive_account', 'gdrive_folder_id', 'gdrive_connected_at']) setSetting(db, k, '');
  if (getSetting(db, 'gdrive_mode', '') === 'api') setSetting(db, 'gdrive_mode', '');
}

async function accessToken(db) {
  const creds = credentials(db);
  const refresh = getSetting(db, 'gdrive_refresh_token', '');
  if (!creds || !refresh) throw new Error('Connect a Google account first');
  try {
    const tok = await tokenRequest({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: refresh, grant_type: 'refresh_token' });
    return tok.access_token;
  } catch (err) {
    if (err.reconnect) { setSetting(db, 'gdrive_refresh_token', ''); }
    throw err;
  }
}

async function gapi(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let msg = t.slice(0, 200);
    try { msg = JSON.parse(t).error.message || msg; } catch { /* plain text */ }
    if (r.status === 403 && /storage|quota/i.test(msg)) msg = 'Your Google Drive is full — free up space or keep fewer backups';
    throw new Error(`Google Drive: ${msg} (${r.status})`);
  }
  return r;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';

// Finds the backup folder — also the one made by an earlier install / another
// PC on the same Google account — or creates it.
async function ensureFolder(db, token, { create = true } = {}) {
  const known = getSetting(db, 'gdrive_folder_id', '');
  if (known) {
    const r = await fetch(`${DRIVE}/${known}?fields=id,trashed`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok && !(await r.json()).trashed) return known;
  }
  const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await (await gapi(token, `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=createdTime&pageSize=10`)).json();
  if (found.files && found.files.length) {
    setSetting(db, 'gdrive_folder_id', found.files[0].id);
    return found.files[0].id;
  }
  if (!create) return null;
  const r = await gapi(token, `${DRIVE}?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  const { id } = await r.json();
  setSetting(db, 'gdrive_folder_id', id);
  return id;
}

async function listApiFiles(token, folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const list = await (await gapi(token, `${DRIVE}?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime,description)&pageSize=200`)).json();
  return (list.files || []).filter((f) => FILE_RE.test(f.name));
}

async function uploadViaApi(db, fileName, buffer, keep) {
  const token = await accessToken(db);
  const folderId = await ensureFolder(db, token);
  const school = getSetting(db, 'school_name', '');
  // Resumable upload: works for any size.
  const start = await gapi(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(buffer.length) },
    body: JSON.stringify({ name: fileName, parents: [folderId], description: `CHAND School Management backup${school ? ` — ${school}` : ''} (v${config.appVersion})` })
  });
  const location = start.headers.get('location');
  const put = await gapi(token, location, { method: 'PUT', headers: { 'Content-Type': 'application/zip', 'Content-Length': String(buffer.length) }, body: buffer });
  const { id } = await put.json();
  // Keep only the newest `keep` backups in the folder.
  for (const f of (await listApiFiles(token, folderId)).slice(keep)) {
    await fetch(`${DRIVE}/${f.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  const account = getSetting(db, 'gdrive_account', '');
  return { id, where: `Google Drive${account ? ` (${account})` : ''} › ${FOLDER_NAME}` };
}

function folderDir(folderPath) {
  if (!folderPath) throw new Error('Choose the Google Drive folder first');
  if (!fs.existsSync(folderPath)) throw new Error(`Folder not found: ${folderPath}. Is Google Drive for desktop running?`);
  return path.join(folderPath, FOLDER_NAME);
}

function uploadToFolder(folderPath, fileName, buffer, keep) {
  const dir = folderDir(folderPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buffer);
  const old = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort().reverse().slice(keep);
  old.forEach((n) => { try { fs.unlinkSync(path.join(dir, n)); } catch { /* in use */ } });
  return { where: dir };
}

let running = null;
async function backupToDrive({ trigger = 'manual' } = {}) {
  if (running) return running;
  running = (async () => {
    const db = getDb();
    const s = settings(db);
    const stamp = localDateTimeStr().replace(/[: ]/g, '-');
    const fileName = `CHAND-backup-${stamp}.zip`;
    try {
      if (!s.mode) throw new Error('Google Drive backup is not set up yet');
      if (s.mode === 'api' && !s.connected) throw new Error('Connect a Google account first');
      const buffer = await backupService.buildFullBackupZip();
      const out = s.mode === 'folder' ? uploadToFolder(s.folder_path, fileName, buffer, s.keep) : await uploadViaApi(db, fileName, buffer, s.keep);
      const last = { ok: true, at: localDateTimeStr(), file: fileName, size: buffer.length, where: out.where, trigger };
      setSetting(db, 'gdrive_last', JSON.stringify(last));
      setSetting(db, 'gdrive_last_ok', JSON.stringify(last));
      setSetting(db, 'gdrive_retry_at', '');
      return last;
    } catch (err) {
      const last = { ok: false, at: localDateTimeStr(), error: err.message, trigger };
      setSetting(db, 'gdrive_last', JSON.stringify(last));
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}

// Is an automatic Drive backup due? Daily / weekly / monthly since the last
// successful one, at or after the chosen time. A failed attempt (no internet,
// PC asleep…) is retried an hour later, like a phone waiting for Wi-Fi.
function driveBackupDue(db, now = new Date()) {
  const s = settings(db);
  if (!s.mode || s.frequency === 'manual') return false;
  if (s.mode === 'api' && !s.connected) return false;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (time < s.time) return false;
  const retryAt = Number(getSetting(db, 'gdrive_retry_at', '')) || 0;
  if (retryAt && now.getTime() < retryAt) return false;
  const lastAt = s.last_ok && s.last_ok.at ? String(s.last_ok.at).slice(0, 10) : '';
  if (!lastAt) return true;
  const today = localDateStr(now);
  if (s.frequency === 'daily') return lastAt < today;
  const days = (new Date(`${today}T00:00:00`) - new Date(`${lastAt}T00:00:00`)) / 86400000;
  return s.frequency === 'weekly' ? days >= 7 : days >= 28 && lastAt.slice(0, 7) < today.slice(0, 7);
}

async function autoDriveBackup(db = getDb(), now = new Date()) {
  if (!driveBackupDue(db, now)) return null;
  try {
    return await backupToDrive({ trigger: 'auto' });
  } catch (err) {
    setSetting(db, 'gdrive_retry_at', String(now.getTime() + 60 * 60000));
    throw err;
  }
}

// ---- Restore (like WhatsApp's "Restore" on a new phone) ----
async function listDriveBackups(db = getDb()) {
  const s = settings(db);
  if (s.mode === 'folder') {
    const dir = folderDir(s.folder_path);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { id: n, name: n, size: st.size, created: localDateTimeStr(st.mtime) };
    }).sort((a, b) => b.name.localeCompare(a.name));
  }
  if (s.mode === 'api' && s.connected) {
    const token = await accessToken(db);
    const folderId = await ensureFolder(db, token, { create: false });
    if (!folderId) return [];
    return (await listApiFiles(token, folderId)).map((f) => ({
      id: f.id, name: f.name, size: Number(f.size) || 0, created: localDateTimeStr(new Date(f.createdTime)), description: f.description || ''
    }));
  }
  throw new Error('Connect Google Drive first');
}

// Downloads one backup from Drive into backups/ and restores it.
async function restoreFromDrive(id, db = getDb()) {
  const s = settings(db);
  const tmp = path.join(config.backupsDir, `drive-${Date.now()}.zip`);
  try {
    if (s.mode === 'folder') {
      if (!FILE_RE.test(id) || path.basename(id) !== id) throw new Error('Backup not found');
      const src = path.join(folderDir(s.folder_path), id);
      if (!fs.existsSync(src)) throw new Error('Backup not found in the Google Drive folder');
      fs.copyFileSync(src, tmp);
    } else {
      if (!/^[\w-]+$/.test(String(id))) throw new Error('Backup not found');
      const token = await accessToken(db);
      const r = await gapi(token, `${DRIVE}/${id}?alt=media`);
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    }
    const imported = await backupService.importUploadedBackup(tmp, 'drive-backup.zip');
    // Keep this PC's Google connection — the backup may be older than it.
    const keepKeys = ['gdrive_mode', 'gdrive_folder_path', 'gdrive_client_id', 'gdrive_client_secret', 'gdrive_refresh_token', 'gdrive_account',
      'gdrive_folder_id', 'gdrive_connected_at', 'gdrive_frequency', 'gdrive_time', 'gdrive_keep', 'gdrive_last', 'gdrive_last_ok'];
    const kept = keepKeys.map((k) => [k, getSetting(db, k, '')]);
    const result = backupService.restoreBackup(imported.fileName);
    const fresh = getDb();
    kept.forEach(([k, v]) => setSetting(fresh, k, v));
    return { ...result, restoredUploads: imported.restoredUploads, fileName: imported.fileName };
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

// Daily local backup into backups/, keeping the newest `keep` automatic ones.
function localAutoBackup() {
  const db = getDb();
  const keep = settings(db).local_keep;
  const b = backupService.createBackup('auto-daily');
  try {
    db.prepare('INSERT INTO backups_log (file_name, size_bytes, created_by) VALUES (?, ?, NULL)').run(b.fileName, b.sizeBytes);
  } catch { /* log table optional */ }
  const autos = backupService.listBackups().filter((x) => String(x.fileName || x.name || '').startsWith('auto-daily-'))
    .sort((a, c) => String(c.fileName || c.name).localeCompare(String(a.fileName || a.name)));
  for (const x of autos.slice(keep)) {
    try { fs.unlinkSync(backupService.backupFilePath(x.fileName || x.name)); } catch { /* ignore */ }
  }
  setSetting(db, 'local_backup_last', localDateTimeStr());
  return b;
}

module.exports = {
  settings, authUrl, handleCallback, disconnect, backupToDrive, autoDriveBackup, driveBackupDue,
  listDriveBackups, restoreFromDrive, localAutoBackup, redirectUri, builtInClient, resetBuiltInCache, FOLDER_NAME, FREQUENCIES
};
