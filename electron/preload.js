const { contextBridge, ipcRenderer } = require('electron');

// Small, explicit bridge for the desktop-only features (multi-PC connection
// mode + Windows Firewall). The web app checks `window.smsDesktop` exists, so
// the same React build still works in a phone browser where this is absent.
contextBridge.exposeInMainWorld('smsDesktop', {
  getConnection: () => ipcRenderer.invoke('desktop:get-connection'),
  openConnectionSettings: () => ipcRenderer.invoke('desktop:open-connection'),
  discoverServers: () => ipcRenderer.invoke('desktop:discover'),
  testServer: (url) => ipcRenderer.invoke('desktop:test', url),
  saveConnection: (payload) => ipcRenderer.invoke('desktop:save-connection', payload),
  allowFirewall: () => ipcRenderer.invoke('desktop:firewall'),
  onMessage: (cb) => ipcRenderer.on('connection:message', (event, message) => cb(message))
});
