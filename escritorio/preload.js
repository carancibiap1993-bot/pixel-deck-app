const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  pathFor: (file) => webUtils.getPathForFile(file),
  expand: (paths) => ipcRenderer.invoke('expand-paths', paths),
  meta: (file, size) => ipcRenderer.invoke('read-meta', file, size),
  exists: (paths) => ipcRenderer.invoke('exists', paths),
  load: () => ipcRenderer.invoke('load-playlist'),
  save: (data) => ipcRenderer.invoke('save-playlist', data),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  cloudGet: () => ipcRenderer.invoke('cloud-config-get'),
  cloudSet: (cfg) => ipcRenderer.invoke('cloud-config-set', cfg),
  cloudList: () => ipcRenderer.invoke('cloud-list')
});
