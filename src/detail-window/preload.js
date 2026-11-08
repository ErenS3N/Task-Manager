const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  getDetail: (taskId) => ipcRenderer.invoke('tasks:getDetail', taskId),

  onTasksUpdated: (callback) => {
    const handler = (_event, updatedTasks) => callback(updatedTasks);
    ipcRenderer.on('tasks:updated', handler);
    return () => ipcRenderer.removeListener('tasks:updated', handler);
  },

  updateNotes: (taskId, notes) =>
    ipcRenderer.invoke('tasks:updateNotes', taskId, notes),
});