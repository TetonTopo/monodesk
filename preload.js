const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('md', {
  copy: (text) => ipcRenderer.invoke('copy', text),
  setMode: (mode) => ipcRenderer.invoke('mode', mode),
  version: () => ipcRenderer.invoke('version'),
  update: () => ipcRenderer.invoke('update'),
  calendar: (force) => ipcRenderer.invoke('calendar', force),
  onShortcut: (fn) => ipcRenderer.on('shortcut', (_e, key) => fn(key)),
  onNewTab: (fn) => ipcRenderer.on('new-tab', (_e, info) => fn(info)),
  onCssChanged: (fn) => ipcRenderer.on('css-changed', () => fn()),
  onToast: (fn) => ipcRenderer.on('toast', (_e, msg) => fn(msg)),
  platform: process.platform,
});
