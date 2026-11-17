const { app, autoUpdater, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage, Notification } = require('electron')
const path = require('node:path');
const fs = require('node:fs');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
const Store = require('electron-store').default;
const Database = require('better-sqlite3')
const dbPath = path.join(app.getPath('userData'), 'tasks.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'To Do',
    priority    TEXT NOT NULL DEFAULT 'Medium',
    notes       TEXT NOT NULL DEFAULT '',
    createdAt   INTEGER NOT NULL,
    updatedAt   INTEGER NOT NULL
  )
`)

// Create a store instance for managing application settings.
const settingsStore = new Store({
  name: 'settings',
  defaults: {
    windowState: { width: 800, height: 623 },
    activeFilter: 'All'
  }
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ── Module-scope window / tray references ─────────────────────────────────────
// IMPORTANT: must be module-scope — a local variable would be GC'd silently.
let mainWindow = null;
let addWindow = null;
let editWindow = null;  // NEW in v3
let detailWindow = null;
let tray = null;  // NEW in v3 — module-scope prevents the GC footgun - GC footgun is when the tray gets garbage collected if not referenced.
let activePriorityFilter = 'All';
let updateState = { status: 'idle' };

const validStatusFilters = new Set(['all', 'To Do', 'In Progress', 'Done']);

function saveWindowSize(window, settingsKey) {
  if (!window || window.isDestroyed()) return;
  const { width, height } = window.getBounds();
  settingsStore.set(settingsKey, { width, height });
}

function publishUpdateState(status) {
  updateState = { status };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:state', updateState);
  }
}

autoUpdater.on('update-available', () => publishUpdateState('available'));
autoUpdater.on('update-not-available', () => publishUpdateState('idle'));
autoUpdater.on('update-downloaded', () => publishUpdateState('downloaded'));
autoUpdater.on('error', error => console.error('[updater] Update check failed:', error));

// ── Helper: push current task list to the main window ─────────────────────────
function pushTasksToRenderer() {
  const allTasks = db.prepare(
    'SELECT * FROM tasks ORDER BY createdAt DESC'
  ).all()

  if (mainWindow) {
    mainWindow.webContents.send('tasks:updated', allTasks);
  }

  if (detailWindow && !detailWindow.isDestroyed()) {
    detailWindow.webContents.send('tasks:updated', allTasks);
  }
  refreshTray();
}

function getIncompleteCount() {
  return db.prepare(
    "SELECT COUNT(*) AS cnt FROM tasks WHERE status != 'Done'"
  ).get().cnt;
}

function refreshTray() {
  if (!tray) return;

  tray.setToolTip(`Task Manager - ${getIncompleteCount()} incomplete`);

  const taskStatusCounts = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM tasks WHERE status = 'Done') AS hasDoneTasks,
      EXISTS(SELECT 1 FROM tasks WHERE status != 'Done') AS hasIncompleteTasks
  `).get();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Tasks',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    {
      label: 'Mark All Done',
      enabled: Boolean(taskStatusCounts.hasIncompleteTasks),
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

        db.prepare(
          "UPDATE tasks SET status='Done', updatedAt=? WHERE status != 'Done'"
        ).run(Date.now());

        pushTasksToRenderer();
      },
    },
    {
      label: 'Clear Done Tasks',
      enabled: Boolean(taskStatusCounts.hasDoneTasks),
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

        db.prepare(
          "DELETE FROM tasks WHERE status = 'Done'"
        ).run();

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
ipcMain.handle('tasks:get', () => {
  return db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC').all()
});

ipcMain.handle('updates:get-state', () => updateState);
ipcMain.handle('updates:install', (event) => {
  if (event.sender !== mainWindow?.webContents || updateState.status !== 'downloaded') {
    return false;
  }

  autoUpdater.quitAndInstall();
  return true;
});

// Open the add window
ipcMain.handle('window:open-add', () => { createAddWindow(); });

// Close the add window
ipcMain.handle('window:close-add', () => {
  if (addWindow) addWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

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

    const now = Date.now();
    const createdAt = Number.isSafeInteger(task.createdAt) && task.createdAt >= 0
      ? task.createdAt
      : now;

    const updatedAt = Number.isSafeInteger(task.updatedAt) && task.updatedAt >= 0
      ? task.updatedAt
      : createdAt;

    const notes = task.notes === undefined ? '' : task.notes;

    if (typeof notes !== 'string' || notes.length > 500) {
      throw new Error('Task notes must be a string of 500 characters or fewer.');
    }

    return {
      id,
      title: String(task.title).slice(0, 120),
      priority: VALID_PRIORITY.includes(task.priority) ? task.priority : 'Low',
      status: VALID_STATUS.includes(task.status) ? task.status : 'To Do',
      notes,
      createdAt,
      updatedAt
    };
  });
}

const insertTask = db.prepare(
  'INSERT INTO tasks (id,title,status,priority,notes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)'
);

const insertTasks = db.transaction((records) => {
  for (const task of records) {
    insertTask.run(
      task.id,
      task.title,
      task.status,
      task.priority,
      task.notes,
      task.createdAt,
      task.updatedAt
    );
  }
});

const replaceTasks = db.transaction((records) => {
  db.prepare('DELETE FROM tasks').run();
  insertTasks(records);
});

function migrateLegacyTasks() {
  if (db.pragma('user_version', { simple: true }) >= 1) return;

  const legacyTaskStore = new Store({
    name: 'tasks',
    defaults: { tasks: [] },
  });
  const legacyRecords = legacyTaskStore.get('tasks');

  if (!Array.isArray(legacyRecords)) {
    throw new Error('Legacy task data must be a list of tasks.');
  }

  const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
  if (taskCount === 0 && legacyRecords.length > 0) {
    insertTasks(sanitiseTasks(legacyRecords));
  }

  db.pragma('user_version = 1');
}

migrateLegacyTasks();

// Add a new task
ipcMain.handle('tasks:add', (_event, task) => {
  // Validate the task object before adding it
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
  
  if (typeof task.title !== 'string' // Title must be a string
      || task.title.trim().length === 0 // Title cannot be empty
      || task.title.length > 120 // Maximum title length is 120 characters
      || !VALID_PRIORITY.includes(task.priority) // Priority must be one of the valid options
      || !VALID_STATUS.includes(task.status))// Status must be one of the valid options
    return null

  // Create a new task object with validated properties
  const now = Date.now();

  // Insert the new task into the database and retrieve it
  const info = db.prepare(
   'INSERT INTO tasks (title,status,priority,notes,createdAt,updatedAt) VALUES (?,?,?,?,?,?)'
  ).run(task.title, task.status, task.priority, '', now, now);

  // Retrieve the newly inserted task from the database
  const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)

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
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return null;
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) ?? null;
});

ipcMain.handle('window:open-detail', (_event, taskId) => {
  createDetailWindow(taskId);
});

// Gives the detail window a dedicated IPC request by task ID and returns the full object
ipcMain.handle('tasks:getDetail', (_event, taskId) => {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return null;
  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId) ?? null;

  return task;
});

// Validates in main, updates only notes and updatedAt
ipcMain.handle('tasks:updateNotes', (_event, taskId, notes) => {
  if (!Number.isInteger(taskId) || taskId <= 0
      || typeof notes !== 'string' || notes.length > 500) {
    return null;
  }

  db.prepare(
    'UPDATE tasks SET notes=?, updatedAt=? WHERE id=?'
  ).run(notes, Date.now(), taskId);

  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId);

  if (!task) return null;

  pushTasksToRenderer();
  return task;
});

// Save edits to an existing task
ipcMain.handle('tasks:update', (_event, updated) => {
  if (!updated
    || typeof updated !== 'object'
    || Array.isArray(updated)
    || typeof updated.title !== 'string'
    || !Number.isInteger(updated.id)
    || updated.id <= 0
    || updated.title.trim().length === 0
    || updated.title.length > 120
    || !VALID_PRIORITY.includes(updated.priority)
    || !VALID_STATUS.includes(updated.status)
  ) {
    return null;
  }

  const updateResult = db.prepare(
    'UPDATE tasks SET title=?,status=?,priority=?,updatedAt=? WHERE id=?'
  ).run(
    updated.title,
    updated.status,
    updated.priority,
    Date.now(),
    updated.id
  );
  if (updateResult.changes === 0) return null;

  const result = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(updated.id);

  pushTasksToRenderer();
  refreshTray();
  return result;
});

ipcMain.handle('tasks:cycleStatus', (_event, taskId) => {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return null;
  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId)

  if (!task) return null;

  const next = VALID_STATUS[(VALID_STATUS.indexOf(task.status) + 1) % VALID_STATUS.length]
  db.prepare(
    'UPDATE tasks SET status=?,updatedAt=? WHERE id=?'
  ).run(next, Date.now(), taskId);

  const cycled = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId);

  if (cycled.status === 'Done') {
    new Notification(
      { title: 'Task complete', body: cycled.title }
    ).show();
  }

  pushTasksToRenderer();
  refreshTray();
  return cycled;
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

  db.prepare(
    'DELETE FROM tasks'
  ).run()

  pushTasksToRenderer();
  return true;
});

// Delete a task — after native confirmation dialog in main
ipcMain.handle('tasks:delete', async (_event, taskId) => {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return false;
  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId);

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

  db.prepare(
    'DELETE FROM tasks WHERE id = ?'
  ).run(taskId)

  pushTasksToRenderer();
  refreshTray();
  return true;
});

// ── NEW in v3 — Context menu on a task card ───────────────────────────────────
// The renderer CANNOT call Menu.buildFromTemplate directly (renderer-process
// restriction). It invokes this handler; main builds the menu and calls
// menu.popup() — different from Menu.setApplicationMenu() which replaces the
// global menu bar.
ipcMain.handle('menu:showTaskContext', (_event, taskId) => {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return false;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return false;

  const menu = Menu.buildFromTemplate([
    {
      label: 'Edit Task',
      click: () => { createEditWindow(taskId); }
    },
    { type: 'separator' },
    {
      label: `Delete "${task.title}"`,
      click: async () => {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Delete Task',
          message: `Delete "${task.title}"?`,
          detail: 'This action cannot be undone.',
          buttons: ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });
        if (result.response === 0) {
          const result = db.prepare(
            'DELETE FROM tasks WHERE id = ?'
          ).run(taskId);

          if (result.changes > 0) pushTasksToRenderer();
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
    const loaded = JSON.parse(
      fs.readFileSync(result.filePaths[0], 'utf8')
    );
    replaceTasks(sanitiseTasks(loaded));

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
    const taskRows = db.prepare(
      'SELECT * FROM tasks ORDER BY createdAt DESC'
    ).all();

    fs.writeFileSync(result.filePath, JSON.stringify(taskRows, null, 2), 'utf8');
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
  settingsStore.set('activeFilter', filter);
});

// ── Window creation ───────────────────────────────────────────────────────────

const createWindow = () => {
  const saved = settingsStore.get('windowState', {});
  mainWindow = new BrowserWindow({
    width: saved.width || 800,
    height: saved.height || 623,
    x: saved.x,
    y: saved.y,
    title: 'Task Manager',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), //<a href="https://www.flaticon.com/free-icons/execution" title="execution icons">Execution icons created by kliwir art - Flaticon</a>
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  //***v5 update - save window state on resize and move */
  function saveWindowState() {
    if (!mainWindow || mainWindow.isMinimized()) return;
    const { x, y, width, height } = mainWindow.getBounds();
    settingsStore.set('windowState', { x, y, width, height });
  }

  /***v5 update:agttach saveWindowState to events */
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('close', saveWindowState);

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.webContents.on('did-finish-load', () => {
    pushTasksToRenderer();
    mainWindow.webContents.send('tasks:filter', activePriorityFilter);
    mainWindow.webContents.send('updates:state', updateState);

    const activeFilter = settingsStore.get('activeFilter');
    if (validStatusFilters.has(activeFilter)) {
      mainWindow.webContents.send('tasks:restoreFilter', activeFilter);
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
  const savedSize = settingsStore.get('addWindowSize', {});

  addWindow = new BrowserWindow({
    width: savedSize.width || 500,
    height: savedSize.height || 623,
    parent: mainWindow,
    modal: true,
    title: 'Add Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: ADD_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  addWindow.loadURL(ADD_WINDOW_WEBPACK_ENTRY);
  addWindow.on('resize', () => saveWindowSize(addWindow, 'addWindowSize'));
  addWindow.on('close', () => saveWindowSize(addWindow, 'addWindowSize'));
  addWindow.on('closed', () => { addWindow = null; });
}

// NEW in v3: Edit window — pre-filled form for an existing task
function createEditWindow(taskId) {
  if (editWindow) { editWindow.focus(); return; }
  const savedSize = settingsStore.get('editWindowSize', {});

  editWindow = new BrowserWindow({
    width: savedSize.width || 500,
    height: savedSize.height || 623,
    parent: mainWindow, modal: true,
    title: 'Edit Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    resizable: true, minimizable: false, maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: EDIT_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  editWindow.loadURL(EDIT_WINDOW_WEBPACK_ENTRY);
  editWindow.on('resize', () => saveWindowSize(editWindow, 'editWindowSize'));
  editWindow.on('close', () => saveWindowSize(editWindow, 'editWindowSize'));

  editWindow.webContents.on('did-finish-load', () => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) ?? null;
    editWindow.webContents.send('edit:loadTask', task);
  });

  editWindow.on('closed', () => { editWindow = null; });
}

function createDetailWindow(taskId) {
  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).get(taskId);

  if (!task) return;

  const detailUrl = new URL(DETAIL_WINDOW_WEBPACK_ENTRY);
  detailUrl.searchParams.set('taskId', String(taskId));

  if (detailWindow) {
    detailWindow.loadURL(detailUrl.toString());
    detailWindow.focus();
    return;
  }

  const savedSize = settingsStore.get('detailWindowSize', {});
  detailWindow = new BrowserWindow({
    width: savedSize.width || 475,
    height: savedSize.height || 623,
    parent: mainWindow,
    modal: false,
    title: 'Task Detail',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: DETAIL_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  detailWindow.on('resize', () => saveWindowSize(detailWindow, 'detailWindowSize'));
  detailWindow.on('close', () => saveWindowSize(detailWindow, 'detailWindowSize'));
  detailWindow.on('closed', () => { detailWindow = null; });
  detailWindow.loadURL(detailUrl.toString());
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
              const loaded = JSON.parse(
                fs.readFileSync(result.filePaths[0], 'utf8')
              );
              replaceTasks(sanitiseTasks(loaded));

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

            const taskRows = db.prepare(
              'SELECT * FROM tasks ORDER BY createdAt DESC'
            ).all();

            fs.writeFileSync(result.filePath, JSON.stringify(taskRows, null, 2), 'utf8');
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
  refreshTray();

  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  createTray();   // NEW in v3

  if (app.isPackaged && process.platform === 'win32') {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'ErenS3N/Task-Manager',
      },
      notifyUser: false,
    });
  }

  // macOS: re-open the window when the Dock icon is clicked
  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

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
  if (db.open) db.close();
});