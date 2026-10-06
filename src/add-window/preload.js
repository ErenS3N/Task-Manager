const { contextBridge, ipcRenderer } = require('electron');
 
contextBridge.exposeInMainWorld('taskAPI', {
 
  // Send a new task object to the main process
  addTask: (task) => ipcRenderer.invoke('tasks:add', task),
 
  // Ask the main process to close this window
  closeWindow: () => ipcRenderer.invoke('window:close-add'),
 
});
 
console.log('[preload] Add window — taskAPI exposed via contextBridge.');
