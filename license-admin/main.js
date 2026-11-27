// "CHAND License Admin" — standalone Windows exe for issuing license keys.
// FOR THE DEVELOPER ONLY: it contains the signing secret, so never give this
// exe to a school.
//
// It wraps scripts/license-admin-page.js (the same page `npm run
// license-admin` serves) in its own window. The page listens on 127.0.0.1 on a
// random free port, so it is never reachable from the network.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.setAppUserModelId('com.chand.license.admin');

const REGISTRY_NAME = 'licenses-issued.json';

// Issued keys are always recorded in %APPDATA%\CHAND License Admin
// (= userData). A licenses-issued.json left next to the exe from an older
// version is copied in once.
process.env.SMS_LICENSE_LEGACY = path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), REGISTRY_NAME);
const registry = require('../scripts/lib/licenseRegistry');
const { startAdminServer } = require('../scripts/license-admin-page');

let win = null;
let server = null;

function iconPath() {
  return path.join(__dirname, 'icon.png');
}

async function importRecords() {
  const result = await dialog.showOpenDialog(win, {
    title: 'Import issued licenses',
    filters: [{ name: 'Licenses list', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    const added = registry.importFrom(result.filePaths[0]);
    dialog.showMessageBox(win, { type: 'info', message: `Imported ${added} license record${added === 1 ? '' : 's'}.`, detail: added ? '' : 'Every record in that file was already in your list.' });
    if (win) win.reload();
  } catch (err) {
    dialog.showErrorBox('Import failed', err.message);
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Import licenses file…', accelerator: 'CmdOrCtrl+I', click: importRecords },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  ]));
}

async function firstRunImportOffer() {
  if (fs.existsSync(registry.registryFile())) return;
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'CHAND License Admin',
    message: 'Do you have keys issued earlier?',
    detail: 'If you used License Admin before (the .bat / npm version), import its licenses-issued.json from the project folder so your list of schools carries over.',
    buttons: ['Import existing list…', 'Start a new list'],
    defaultId: 0,
    cancelId: 1
  });
  if (choice.response === 0) await importRecords();
}

async function createWindow() {
  server = await startAdminServer(0);
  const url = `http://127.0.0.1:${server.address().port}/`;
  win = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'CHAND License Admin',
    icon: iconPath(),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.once('ready-to-show', () => {
    win.show();
    firstRunImportOffer();
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  win.loadURL(url);
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow().catch((err) => {
      dialog.showErrorBox('License Admin failed to start', err.message);
      app.quit();
    });
  });
  app.on('window-all-closed', () => {
    if (server) server.close();
    app.quit();
  });
}
