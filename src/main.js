const { app, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage, Notification } = require('electron')
const path = require('node:path');
const fs = require('node:fs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ── Task data — owned by main (same as v2) ────────────────────────────────────
let nextId = 5;

const tasks = [
  { id: 1, title: 'Design dashboard screen', priority: 'High', status: 'In Progress' },
  { id: 2, title: 'Write unit tests for API', priority: 'Medium', status: 'To Do' },
  { id: 3, title: 'Update README documentation', priority: 'Low', status: 'Done' },
  { id: 4, title: 'Fix login bug', priority: 'High', status: 'To Do' },
];

// ── Module-scope window / tray references ─────────────────────────────────────
// IMPORTANT: must be module-scope — a local variable would be GC'd silently.
let mainWindow = null;
let addWindow = null;
let editWindow = null;  // NEW in v3
let tray = null;  // NEW in v3 — module-scope prevents the GC footgun - GC footgun is when the tray gets garbage collected if not referenced.
let activePriorityFilter = 'All';

/*** V5 update - Declare the settingsPath variable for storing the path to the settings.json file ***/
// let settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settingsPath = null;
const validStatusFilters = new Set(['all', 'To Do', 'In Progress', 'Done']);
const validStatusFilters = new Set(['all', 'To Do', 'In Progress', 'Done']);

/*** v5 update - Load and save settings functions for managing the settings.json file */
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}
// *** V5 update - Save the settings.json file with the provided patch (updates).
function saveSettings(patch) {
  const current = loadSettings();
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ ...current, ...patch }, null, 2)
  );
}

// ── Helper: push current task list to the main window ─────────────────────────
function pushTasksToRenderer() {
  if (mainWindow) {
    mainWindow.webContents.send('tasks:updated', tasks);
  }
  refreshTrayUI();
}

function getIncompleteCount() {
  return tasks.filter(task => task.status !== 'Done').length;
}

function refreshTrayUI() {
  if (!tray) return;

  tray.setToolTip(`Task Manager - ${getIncompleteCount()} incomplete`);

  const hasDoneTasks = tasks.some(task => task.status === 'Done');
  const hasIncompleteTasks = tasks.some(task => task.status !== 'Done');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Tasks',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    {
      label: 'Mark All Done',
      enabled: hasIncompleteTasks,
      click: async () => {
        const confirm = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Mark All Done',
          message: 'Mark every task as Done?',
          detail: 'You can still cycle statuses later if needed.',
          buttons: ['Mark All', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });

        if (confirm.response !== 0) return;

        tasks.forEach(task => {
          task.status = 'Done';
        });
        pushTasksToRenderer();
      },
    },
    {
      label: 'Clear Done Tasks',
      enabled: hasDoneTasks,
      click: async () => {
        const confirm = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Clear Done Tasks',
          message: 'Remove all completed tasks?',
          detail: 'This action cannot be undone.',
          buttons: ['Clear Done', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });

        if (confirm.response !== 0) return;

        for (let i = tasks.length - 1; i >= 0; i -= 1) {
          if (tasks[i].status === 'Done') {
            tasks.splice(i, 1);
          }
        }

        pushTasksToRenderer();
      },
    },
    { type: 'separator' },
    { role: 'quit' },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// ── Carried forward from v2 ───────────────────────────────────────────────────

// Return the full task list
ipcMain.handle('tasks:get', () => tasks);

// Open the add window
ipcMain.handle('window:open-add', () => { createAddWindow(); });

// Close the add window
ipcMain.handle('window:close-add', () => { if (addWindow) addWindow.close(); });

// Validation constants for task properties
const VALID_PRIORITY = ['Low', 'Medium', 'High']
const VALID_STATUS = ['To Do','In Progress','Done']

// Verfies tasks json files match the approved fields
function sanitiseTasks(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error('The task file must contain a list of tasks.');
  }

  const seenIds = new Set();

  return parsed.map(task => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      throw new Error('Each task must be an object.');
    }

    const id = Number(task.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seenIds.has(id)) {
      throw new Error('Each task must have a unique positive whole-number ID.');
    }
    seenIds.add(id);

    return {
      id,
      title: String(task.title).slice(0, 120),
      priority: VALID_PRIORITY.includes(task.priority) ? task.priority : 'Low',
      status: VALID_STATUS.includes(task.status) ? task.status : 'To Do',
    };
  });
}

// Add a new task
ipcMain.handle('tasks:add', (_event, task) => {
  // Validate the task object before adding it
  if (typeof task.title !== 'string' // Title must be a string  
      || task.title.trim().length === 0 // Title cannot be empty
      || task.title.length > 120 // Maximum title length is 120 characters
      || !VALID_PRIORITY.includes(task.priority) // Priority must be one of the valid options
      || !VALID_STATUS.includes(task.status))// Status must be one of the valid options
    return null
  
  // Create a new task object with validated properties
  // Validate the task object before adding it
  if (typeof task.title !== 'string' // Title must be a string  
      || task.title.trim().length === 0 // Title cannot be empty
      || task.title.length > 120 // Maximum title length is 120 characters
      || !VALID_PRIORITY.includes(task.priority) // Priority must be one of the valid options
      || !VALID_STATUS.includes(task.status))// Status must be one of the valid options
    return null
  
  // Create a new task object with validated properties
  const newTask = {
    id: nextId++,
    title: task.title,
    priority: task.priority,
    status: task.status,
  };
  tasks.push(newTask);
  pushTasksToRenderer();
  return newTask;
});

// ── NEW in v3 — Edit / Delete ─────────────────────────────────────────────────

// Open the edit window for a specific task
ipcMain.handle('window:open-edit', (_event, taskId) => {
  createEditWindow(taskId);
});

// Close the edit window
ipcMain.handle('window:close-edit', () => { if (editWindow) editWindow.close(); });

// Return a single task by id (used by the edit window to pre-fill the form)
ipcMain.handle('tasks:getOne', (_event, taskId) => {
  return tasks.find(t => t.id === taskId) || null;
});

// Save edits to an existing task
ipcMain.handle('tasks:update', (_event, updated) => {
  if (!updated 
    || typeof updated !== 'object' 
    || !Number.isInteger(updated.id) 
    || updated.id <= 0 
    || typeof updated.title !== 'string' 
    || updated.title.trim().length === 0 
    || updated.title.length > 120 
    || !VALID_PRIORITY.includes(updated.priority) 
    || !VALID_STATUS.includes(updated.status)
  ) {
    return null;
  }

  const idx = tasks.findIndex(t => t.id === updated.id);
  if (idx === -1) return null;

  tasks[idx] = {
    id: updated.id,
    title: updated.title,
    priority: updated.priority,
    status: updated.status,
  };

  pushTasksToRenderer();
  return tasks[idx];
});

ipcMain.handle('tasks:cycleStatus', (_event, taskId) => {
  if (!Number.isInteger(taskId) || taskId <= 0) return null;
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;

  const statusOrder = ['To Do', 'In Progress', 'Done'];
  const currentIndex = statusOrder.indexOf(tasks[idx].status);
  const nextIndex = (currentIndex + 1) % statusOrder.length;
  tasks[idx].status = statusOrder[nextIndex];

  if (tasks[idx].status === 'Done') {
    new Notification({
      title: 'Task complete',
      body: tasks[idx].title.slice(0, 80),
    }).show();
  }

  pushTasksToRenderer();
  return tasks[idx];
});

ipcMain.handle('tasks:clearAll', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Clear All Tasks',
    message: 'Clear every task?',
    detail: 'This action cannot be undone.',
    buttons: ['Clear All', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });

  if (result.response !== 0) return false;

  tasks.splice(0, tasks.length);
  pushTasksToRenderer();
  return true;
});

// Delete a task — after native confirmation dialog in main
ipcMain.handle('tasks:delete', async (_event, taskId) => {
  if (!Number.isInteger(taskId) || taskId <= 0) return false;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  // dialog.showMessageBox runs in main (dialog module is main-process only)
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Delete Task',
    message: `Delete "${task.title}"?`,
    detail: 'This action cannot be undone.',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,   // Cancel is the safe default — Enter key triggers it
    cancelId: 1,   // Esc key also maps to Cancel
  });

  if (result.response !== 0) return false;   // 0 = Delete button

  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  pushTasksToRenderer();
  return true;
});

// ── NEW in v3 — Context menu on a task card ───────────────────────────────────
// The renderer CANNOT call Menu.buildFromTemplate directly (renderer-process
// restriction). It invokes this handler; main builds the menu and calls
// menu.popup() — different from Menu.setApplicationMenu() which replaces the
// global menu bar.
ipcMain.handle('menu:showTaskContext', (_event, taskId, taskTitle) => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Edit Task',
      click: () => { createEditWindow(taskId); }
    },
    { type: 'separator' },
    {
      label: `Delete "${taskTitle}"`,
      click: async () => {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Delete Task',
          message: `Delete "${taskTitle}"?`,
          detail: 'This action cannot be undone.',
          buttons: ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });
        if (result.response === 0) {
          const idx = tasks.findIndex(t => t.id === taskId);
          if (idx !== -1) {
            tasks.splice(idx, 1);
            pushTasksToRenderer();
          }
        }
      }
    },
  ]);

  // popup() positions the menu under the cursor in the window.
  // setApplicationMenu() would replace the entire menu bar — NOT what we want here.
  menu.popup({ window: mainWindow });
});

// ── NEW in v3 — File dialogs ──────────────────────────────────────────────────

// Open a JSON file and load tasks from it
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  try {
    const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    const clean = sanitiseTasks(loaded);
    tasks.splice(0, tasks.length, ...clean);
    nextId = Math.max(...tasks.map(t => t.id), 0) + 1;
    pushTasksToRenderer();
    return true;
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', message: 'Could not read file', detail: err.message,
    });
    return false;
  }
});

// Save current tasks to a JSON file
ipcMain.handle('dialog:saveFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'tasks.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(tasks, null, 2), 'utf8');
    return true;
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', message: 'Could not save file', detail: err.message,
    });
    return false;
  }
});

ipcMain.on('settings:saveFilter', (_event, filter) => {
  if (!validStatusFilters.has(filter)) return;
  saveSettings({ activeFilter: filter });
});
ipcMain.on('settings:saveFilter', (_event, filter) => {
  if (!validStatusFilters.has(filter)) return;
  saveSettings({ activeFilter: filter });
});

let saved = {};

// ── Window creation ───────────────────────────────────────────────────────────

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: saved.width || 800, // *** v5 update - use saved width if available, otherwise default to 800
    height: saved.height || 600, // *** v5 update - use saved height if available, otherwise default to 600
    x: saved.x, // *** v5 update - undefined = OS places the window
    y: saved.y, // *** v5 update
    title: 'Task Manager',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), //<a href="https://www.flaticon.com/free-icons/execution" title="execution icons">Execution icons created by kliwir art - Flaticon</a>
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      sandbox: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  //***v5 update - save window state on resize and move */
  function saveWindowState() {
    if (!mainWindow || mainWindow.isMinimized()) return;
    const { x, y, width, height } = mainWindow.getBounds();
    saveSettings({ windowState: { x, y, width, height } });
  }

  /***v5 update:agttach saveWindowState to events */
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.webContents.on('did-finish-load', () => {
    pushTasksToRenderer();
    mainWindow.webContents.send('tasks:filter', activePriorityFilter);
    mainWindow.webContents.send('tasks:filter', activePriorityFilter);
    const settings = loadSettings();
    if (validStatusFilters.has(settings.activeFilter)) {
      mainWindow.webContents.send('tasks:restoreFilter', settings.activeFilter);
    if (validStatusFilters.has(settings.activeFilter)) {
      mainWindow.webContents.send('tasks:restoreFilter', settings.activeFilter);
    }
  });

  // NEW in v3: 'close' fires BEFORE the window closes — we can cancel it
  // and hide to tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();  // cancel the close
      mainWindow.hide();        // hide to tray
    }
  });

  // 'closed' fires AFTER the window is destroyed — null the reference.
  // (Same pattern as v2, but now meaningful because hide-to-tray keeps
  // the window alive most of the time.)
  mainWindow.on('closed', () => { mainWindow = null; });
};

function createAddWindow() {
  if (addWindow) { addWindow.focus(); return; }

  addWindow = new BrowserWindow({
    width: 440,
    height: 380,
    parent: mainWindow,
    modal: true,
    title: 'Add Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      sandbox: true,
      preload: ADD_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  addWindow.loadURL(ADD_WINDOW_WEBPACK_ENTRY);
  addWindow.on('closed', () => { addWindow = null; });
}

// NEW in v3: Edit window — pre-filled form for an existing task
function createEditWindow(taskId) {
  if (editWindow) { editWindow.focus(); return; }

  editWindow = new BrowserWindow({
    width: 440, height: 380,
    parent: mainWindow, modal: true,
    title: 'Edit Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    resizable: false, minimizable: false, maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      sandbox: true,
      preload: EDIT_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  editWindow.loadURL(EDIT_WINDOW_WEBPACK_ENTRY);

  editWindow.webContents.on('did-finish-load', () => {
    const task = tasks.find(t => t.id === taskId);
    editWindow.webContents.send('edit:loadTask', task);
  });

  editWindow.on('closed', () => { editWindow = null; });
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const priorityFilterItems = ['All', 'High', 'Medium', 'Low'].map((priority) => ({
    label: priority,
    type: 'radio',
    checked: priority === activePriorityFilter,
    click: () => {
      activePriorityFilter = priority;
      if (mainWindow) {
        mainWindow.webContents.send('tasks:filter', priority);
      }
    },
  }));

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Task',
          accelerator: 'CmdOrCtrl+N',
          click: () => createAddWindow(),
        },
        { type: 'separator' },
        {
          label: 'Open Tasks…',    // NEW in v3
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            try {
              const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
              const clean = sanitiseTasks(loaded);
              tasks.splice(0, tasks.length, ...clean);
              nextId = Math.max(...tasks.map(t => t.id), 0) + 1;
              pushTasksToRenderer();
            } catch (err) {
              dialog.showMessageBox(mainWindow, {
                type: 'error', message: 'Could not read file', detail: err.message,
              });
            }
          },
        },
        {
          label: 'Save Tasks…',    // NEW in v3
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              defaultPath: 'tasks.json',
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
            });
            if (result.canceled || !result.filePath) return;
            fs.writeFileSync(result.filePath, JSON.stringify(tasks, null, 2), 'utf8');
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Filter by Priority',
          submenu: priorityFilterItems,
        },
        { type: 'separator' },
        { role: 'reload' },
        { 
          role: 'toggleDevTools', 
          visible: !app.isPackaged 
        },
        { 
          role: 'toggleDevTools', 
          visible: !app.isPackaged 
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── NEW in v3 — Tray ──────────────────────────────────────────────────────────
function createTray() {
  // nativeImage.createFromPath — if the icon file doesn't exist Electron
  // returns an empty image rather than crashing, so this is safe in dev.
  const iconPath = path.join(process.resourcesPath, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);           // assigned to module-scope let (not const!)
  refreshTrayUI();

  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  /*** v5 update -> assign settingsPath here, after the app is ready.
  app.getPath('userData') is only safe to call after whenReady() resolves. ***/
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  console.log('settings path', settingsPath);

  // *** v5 update - get the saved window state or default to an empty object
  saved = loadSettings().windowState || {};

  buildMenu();
  createWindow();
  createTray();   // NEW in v3

  // macOS: re-open the window when the Dock icon is clicked
  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

  saveSettings({ test: true }); // v4 test 2
  console.log(loadSettings()); // v4  test 1
});

// Windows / Linux: quit when the last window closes.
// macOS: the app stays alive (Dock icon remains; 'activate' re-opens it).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// NEW in v3: signal the 'close' handler that we really are quitting,
// so it doesn't intercept and hide the window to tray again.
app.on('before-quit', () => {
  app.isQuitting = true;
  if (tray) tray.destroy();
});
