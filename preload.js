const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  aiFix: (data) => ipcRenderer.invoke('ai-fix', data),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  updateApiKey: (key) => ipcRenderer.invoke('update-api-key', key),
  analyzeAndRun: (code) => ipcRenderer.invoke('analyze-and-run', code),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openProjectFolder: (path) => ipcRenderer.invoke('open-project-folder', path),
  refreshPreview: () => ipcRenderer.invoke('refresh-preview'),
  openPreview: () => ipcRenderer.invoke('open-preview'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => callback(data));
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('status-update');
  }
});