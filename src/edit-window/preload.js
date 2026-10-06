const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  onLoadTask:  (cb)   => ipcRenderer.on('edit:loadTask', (_e, task) => cb(task)),
  updateTask:  (task) => ipcRenderer.invoke('tasks:update', task),
  closeWindow: ()     => ipcRenderer.invoke('window:close-edit'),
});