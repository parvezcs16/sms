const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { spawn, execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Data location — pinned so updates (and the rename to "CHAND School
// Management") can never move a school onto an empty database.
//
// Electron derives userData from the app's productName. Renaming the product
// would silently point the app at a brand-new, empty folder and make it look as
// if every student/teacher/fee record had vanished after an update. Pinning the
// folder name to the original one keeps every existing install on its data.
// ---------------------------------------------------------------------------
// Branding for white-label builds: scripts/package-brand.js writes
// electron/brand.json; without it this is the CHAND build.
const BRAND = (() => {
  const defaults = { id: 'chand', shortName: 'CHAND', productName: 'CHAND School Management', fullName: 'CHAND School Management System', phone: '', appId: 'com.school.management.system', dataFolder: 'school-management-system', logo: 'chand-logo.png' };
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'brand.json'), 'utf8')) }; } catch { return defaults; }
})();
const DATA_FOLDER_NAME = BRAND.dataFolder;
// SMS_USER_DATA_DIR is only for testing a build against a throwaway folder.
app.setPath('userData', process.env.SMS_USER_DATA_DIR || path.join(app.getPath('appData'), DATA_FOLDER_NAME));
app.setAppUserModelId(BRAND.appId);

const APP_TITLE = BRAND.fullName;
// Normally 3000. If another program on this PC already uses it, the school can
// move CHAND to a free port once; that choice is kept in userData/port.json.
const DEFAULT_PORT = 3000;
function portFile() {
  return path.join(app.getPath('userData'), 'port.json');
}
function savedPort() {
  try { return Number(JSON.parse(fs.readFileSync(portFile(), 'utf8')).port) || null; } catch { return null; }
}
let PORT = Number(process.env.PORT) || savedPort() || DEFAULT_PORT;
const DISCOVERY_PORT = 41234;
const DISCOVERY_PROBE = 'CHAND_SMS_DISCOVER';
const ICON_PATH = path.join(__dirname, 'icon.png');

let mainWindow = null;
let connectionWindow = null;
let serverProcess = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Connection mode (stored in userData/connection.json)
//   server — this PC runs the database + API (the default; existing installs
//            keep behaving exactly as before).
//   client — this PC opens the app from the school's main server PC over the
//            LAN, so every PC works on the SAME data instead of each keeping
//            its own separate database that never syncs.
// ---------------------------------------------------------------------------
function connectionFile() {
  return path.join(app.getPath('userData'), 'connection.json');
}

function readConnection() {
  try {
    const parsed = JSON.parse(fs.readFileSync(connectionFile(), 'utf8'));
    if (parsed.mode === 'client' && parsed.serverUrl) return { mode: 'client', serverUrl: normalizeUrl(parsed.serverUrl) };
  } catch { /* first run or unreadable — fall back to server mode */ }
  return { mode: 'server', serverUrl: null };
}

function writeConnection(conn) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(connectionFile(), JSON.stringify(conn, null, 2));
}

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  if (!url.port) url.port = String(PORT);
  return `${url.protocol}//${url.hostname}:${url.port}`;
}

function checkServer(baseUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    try {
      const req = http.get(`${baseUrl}/api/health`, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            done({ ok: res.statusCode === 200, version: json.version || null, isChand: json.app === 'chand-sms' || json.status === 'ok' });
          } catch {
            done({ ok: false, error: `Not a ${BRAND.productName} server` });
          }
        });
      });
      req.on('timeout', () => { req.destroy(); done({ ok: false, error: 'Timed out — check the IP address and that the server PC is on' }); });
      req.on('error', (err) => done({ ok: false, error: err.code === 'ECONNREFUSED' ? 'Connection refused — is the app open on the server PC?' : err.message }));
    } catch (err) {
      done({ ok: false, error: err.message });
    }
  });
}

// Broadcasts a probe on the LAN and collects replies from CHAND servers.
function discoverServers(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg, rinfo) => {
      try {
        const info = JSON.parse(msg.toString());
        if (info.app !== 'chand-sms') return;
        const url = `http://${rinfo.address}:${info.port || PORT}`;
        found.set(url, { url, host: info.host || rinfo.address, schoolName: info.schoolName || '', version: info.version || '' });
      } catch { /* ignore stray packets */ }
    });
    socket.on('error', () => { try { socket.close(); } catch { /* ignore */ } resolve([...found.values()]); });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const probe = Buffer.from(DISCOVERY_PROBE);
      socket.send(probe, DISCOVERY_PORT, '255.255.255.255');
      setTimeout(() => socket.send(probe, DISCOVERY_PORT, '255.255.255.255'), 600);
    });
    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Backend (server mode only)
// ---------------------------------------------------------------------------
function startBackend() {
  // Run the pre-bundled server (see scripts/build-server.js), not server/server.js
  // directly. Spawning Electron's run-as-node runtime as a child of a running
  // Electron GUI process has proven unreliable resolving some nested npm
  // packages (observed with express's qs -> side-channel -> get-proto chain) —
  // the bundle has zero runtime node_modules resolution, which sidesteps it.
  const serverScript = path.join(__dirname, '..', 'server-dist', 'server.js');
  const userData = app.getPath('userData');
  fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
  const logStream = fs.createWriteStream(path.join(userData, 'logs', 'server.log'), { flags: 'a' });

  serverProcess = spawn(process.execPath, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      SMS_DATA_DIR: userData
    }
  });
  serverProcess.stdout.pipe(logStream);
  serverProcess.stderr.pipe(logStream);

  serverProcess.on('error', (err) => {
    dialog.showErrorBox('Failed to start backend', `${err.message}\n\nSee log: ${path.join(userData, 'logs', 'server.log')}`);
  });

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting && code && code !== 0 && mainWindow === null) {
      dialog.showErrorBox('Backend exited unexpectedly', `The application server stopped (exit code ${code}). Check that port ${PORT} is free and try again.`);
      app.quit();
    }
  });
}

function stopBackend() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// Waits until OUR server answers. Any other program answering on the port
// (a different app's web server) does not count.
function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function retry(why) {
      if (Date.now() > deadline) reject(new Error(why || 'Timed out waiting for the local server to start.'));
      else setTimeout(attempt, 400);
    }
    function attempt() {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* not ours */ }
          if (json && json.app === 'chand-sms') resolve(json);
          else retry(`Another program is answering on port ${PORT} instead of ${BRAND.productName}.`);
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => { req.destroy(); retry(); });
    }
    attempt();
  });
}

// Can this PC still open the port? Checks IPv4 and IPv6 separately — on Windows
// another program on [::]:3000 does not stop us binding 0.0.0.0:3000, yet it
// can still capture the browser's connections to it.
function canListen(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL'));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}
async function portFree(port) {
  return (await canListen(port, '0.0.0.0')) && (await canListen(port, '::'));
}
async function findFreePort(from) {
  for (let p = from; p < from + 50; p += 1) if (await portFree(p)) return p;
  return null;
}
// Name of the program holding a port, for a clearer message (best effort).
function portOwner(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    const cmd = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName + '|' + $p.Path } }`;
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 6000 }, (err, out) => resolve(err ? '' : String(out || '').trim()));
  });
}

// Before starting our server: if the port is taken by a different program,
// offer to use a free port instead (remembered for next time).
async function ensurePort() {
  if (await portFree(PORT)) return true;
  const already = await checkServer(`http://127.0.0.1:${PORT}`, 2000);
  if (already.ok && already.isChand && already.version) return 'running'; // our own server is still up
  const [owner, next] = await Promise.all([portOwner(PORT), findFreePort(PORT + 1)]);
  const [name, exe] = owner.split('|');
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: APP_TITLE,
    message: `Port ${PORT} is being used by another program on this PC${name ? ` (${name})` : ''}.`,
    detail: `${exe ? `Program: ${exe}

` : ''}${BRAND.productName} can't share the port with it.

`
      + (next ? `• Use port ${next}: ${BRAND.shortName} moves to port ${next} now and keeps using it. Phones and PCs that find this server automatically will follow; a PC that was set up by typing this PC's address must be changed to :${next}.
` : '')
      + `• Or close the other program and click Try again.`,
    buttons: next ? [`Use port ${next}`, 'Try again', 'Quit'] : ['Try again', 'Quit'],
    defaultId: 0,
    cancelId: next ? 2 : 1,
    noLink: true
  });
  const label = (next ? [`Use port ${next}`, 'Try again', 'Quit'] : ['Try again', 'Quit'])[choice];
  if (label === 'Quit') return false;
  if (label === 'Try again') return ensurePort();
  PORT = next;
  try { fs.writeFileSync(portFile(), JSON.stringify({ port: next, reason: `port ${DEFAULT_PORT} in use by ${name || 'another program'}`, at: new Date().toISOString() }, null, 2)); } catch { /* still use it this time */ }
  return true;
}

// ---------------------------------------------------------------------------
// Windows Firewall — phones and other PCs can only reach this server if
// Windows allows inbound connections to it. Adds the rules once, elevated.
// ---------------------------------------------------------------------------
function firewallRuleScript() {
  const exe = process.execPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `Remove-NetFirewallRule -DisplayName '${BRAND.productName} (LAN)'`,
    `Remove-NetFirewallRule -DisplayName '${BRAND.productName} (Discovery)'`,
    `Remove-NetFirewallRule -DisplayName '${BRAND.productName} (App)'`,
    `New-NetFirewallRule -DisplayName '${BRAND.productName} (LAN)' -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Any`,
    `New-NetFirewallRule -DisplayName '${BRAND.productName} (Discovery)' -Direction Inbound -Protocol UDP -LocalPort ${DISCOVERY_PORT} -Action Allow -Profile Any`,
    `New-NetFirewallRule -DisplayName '${BRAND.productName} (App)' -Direction Inbound -Program '${exe}' -Action Allow -Profile Any`
  ].join('; ');
}

function allowThroughFirewall() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, error: 'Only needed on Windows' });
    const scriptPath = path.join(app.getPath('temp'), 'chand-sms-firewall.ps1');
    fs.writeFileSync(scriptPath, firewallRuleScript().split('; ').join('\r\n'), 'utf8');
    const quoted = scriptPath.replace(/'/g, "''");
    // Start-Process -Verb RunAs shows the normal Windows UAC prompt.
    const outer = `try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${quoted}"' -ErrorAction Stop; exit 0 } catch { exit 1 }`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outer], { windowsHide: true }, (err) => {
      try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      if (err) resolve({ ok: false, error: 'Permission was not granted (UAC prompt cancelled).' });
      else resolve({ ok: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    title: APP_TITLE,
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target) && !target.startsWith(url)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  // If a client PC loses the server mid-session, offer the connection screen
  // instead of leaving a blank window.
  mainWindow.webContents.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted navigation, harmless
    const conn = readConnection();
    if (conn.mode === 'client') {
      openConnectionWindow(`Could not reach the server at ${conn.serverUrl} (${description}).`);
    }
  });
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openConnectionWindow(message = '') {
  if (connectionWindow) {
    connectionWindow.focus();
    connectionWindow.webContents.send('connection:message', message);
    return;
  }
  connectionWindow = new BrowserWindow({
    width: 680,
    height: 760,
    resizable: true,
    title: `${APP_TITLE} — Connection`,
    icon: ICON_PATH,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  connectionWindow.setMenuBarVisibility(false);
  connectionWindow.loadFile(path.join(__dirname, 'connection.html'), { query: { message } });
  connectionWindow.on('closed', () => {
    connectionWindow = null;
    if (!mainWindow && !quitting) app.quit();
  });
}

async function launch() {
  const conn = readConnection();
  if (conn.mode === 'client') {
    const status = await checkServer(conn.serverUrl);
    if (!status.ok) {
      openConnectionWindow(`Could not reach the main server at ${conn.serverUrl}. ${status.error || ''}`.trim());
      return;
    }
    createMainWindow(conn.serverUrl);
    return;
  }

  const portOk = await ensurePort();
  if (!portOk) { app.quit(); return; }
  if (portOk !== 'running') startBackend();
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/health`, 20000);
  } catch (err) {
    stopBackend();
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Startup Error',
      message: err.message,
      detail: `Another program may already be using port ${PORT}.\nSee log: ${path.join(app.getPath('userData'), 'logs', 'server.log')}\n\nIf this PC should use another PC as the main server, choose "Connection Settings".`,
      buttons: ['Connection Settings', 'Quit'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice === 0) openConnectionWindow();
    else app.quit();
    return;
  }
  createMainWindow(`http://127.0.0.1:${PORT}`);
}

function relaunchWith(conn) {
  writeConnection(conn);
  quitting = true;
  stopBackend();
  app.relaunch();
  app.exit(0);
}

function buildMenu() {
  const template = [
    {
      label: 'App',
      submenu: [
        { label: 'Connection Settings…', accelerator: 'CmdOrCtrl+Shift+K', click: () => openConnectionWindow() },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC used by preload.js (connection screen + Settings page)
// ---------------------------------------------------------------------------
ipcMain.handle('desktop:get-connection', () => ({ ...readConnection(), port: PORT, version: app.getVersion(), brand: { productName: BRAND.productName, fullName: BRAND.fullName, shortName: BRAND.shortName, phone: BRAND.phone, logo: BRAND.logo } }));
ipcMain.handle('desktop:open-connection', () => { openConnectionWindow(); return true; });
ipcMain.handle('desktop:discover', () => discoverServers());
ipcMain.handle('desktop:test', async (event, rawUrl) => {
  try {
    const url = normalizeUrl(rawUrl);
    if (!url) return { ok: false, error: 'Enter the server PC address' };
    return { ...(await checkServer(url)), url };
  } catch (err) {
    return { ok: false, error: 'Invalid address' };
  }
});
ipcMain.handle('desktop:save-connection', async (event, payload) => {
  if (payload && payload.mode === 'client') {
    const url = normalizeUrl(payload.serverUrl);
    const status = await checkServer(url);
    if (!status.ok) return { ok: false, error: status.error || 'Server not reachable' };
    relaunchWith({ mode: 'client', serverUrl: url });
  } else {
    relaunchWith({ mode: 'server', serverUrl: null });
  }
  return { ok: true };
});
ipcMain.handle('desktop:firewall', () => allowThroughFirewall());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow || connectionWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    launch();
  });

  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    stopBackend();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) launch();
  });
}
