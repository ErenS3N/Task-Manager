const { contextBridge, ipcRenderer } = require('electron');

// ── CONCEPT: contextBridge ────────────────────────────────────────────────────
// We expose exactly the functions the renderer needs — nothing more.
// The renderer never sees ipcRenderer itself.
// This prevents a malicious script from calling arbitrary IPC channels.

contextBridge.exposeInMainWorld('taskAPI', {

  // ── Carried forward from v2 ───────────────────────────────────────────────

  // Ask the main process to open the add window
  openAddWindow: () => ipcRenderer.invoke('window:open-add'),

  // Ask the main process for the current task list
  getTasks: () => ipcRenderer.invoke('tasks:get'),

  // Register a callback — main will call this when the list changes.
  onTasksUpdated: (callback) => {
    const handler = (_event, tasks) => callback(tasks);
    ipcRenderer.on('tasks:updated', handler);
    return () => ipcRenderer.removeListener('tasks:updated', handler);
  },

  // ── NEW in v3 — Edit / Delete ─────────────────────────────────────────────

  // Ask main to open the edit window for this task id
  openEditWindow: (taskId) => ipcRenderer.invoke('window:open-edit', taskId),

  // Ask main to delete a task — includes the native confirmation dialog in main
  deleteTask: (taskId) => ipcRenderer.invoke('tasks:delete', taskId),

  // Cycle task status in main: To Do -> In Progress -> Done -> To Do
  cycleStatus: (taskId) => ipcRenderer.invoke('tasks:cycleStatus', taskId),

  // Confirm and clear all tasks in main
  clearAllTasks: () => ipcRenderer.invoke('tasks:clearAll'),

  // ── NEW in v3 — Context menu ──────────────────────────────────────────────
  // Renderer cannot call Menu.buildFromTemplate directly.
  // This sends the task id/title to main, which builds and pops up the menu.
  showTaskContextMenu: (taskId, taskTitle) =>
    ipcRenderer.invoke('menu:showTaskContext', taskId, taskTitle),

  // ── NEW in v3 — File dialogs ──────────────────────────────────────────────
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: () => ipcRenderer.invoke('dialog:saveFile'),

  // Receives priority filter selection from the main process menu
  onPriorityFilter: (callback) => {
    const handler = (_event, priority) => callback(priority);
    ipcRenderer.on('tasks:filter', handler);
    return () => ipcRenderer.removeListener('tasks:filter', handler);
  },

});

console.log('[preload] Main window — taskAPI exposed via contextBridge.');
