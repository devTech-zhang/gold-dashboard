const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goldDashboard', {
  fetchGoldQuote: (source) => ipcRenderer.invoke('gold:fetch', source),
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  openSettingsWindow: () => ipcRenderer.invoke('settings:open-window'),
  closeSettingsWindow: () => ipcRenderer.send('settings:close-window'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  logRendererError: (payload) => ipcRenderer.send('app:renderer-error', payload),
  closeWindow: () => ipcRenderer.send('window:close'),
  quitApp: () => ipcRenderer.send('window:quit'),
  startWindowDrag: (point) => ipcRenderer.send('window:drag-start', point),
  moveWindowDrag: (point) => ipcRenderer.send('window:drag-move', point),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  shakeWindow: () => ipcRenderer.invoke('window:shake'),
  onOpenSettings: (callback) => on('ui:open-settings', callback),
  onSettingsChanged: (callback) => on('settings:changed', callback),
  onWindowModeChanged: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('ui:window-mode-changed', listener);
    return () => ipcRenderer.removeListener('ui:window-mode-changed', listener);
  },
});

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
