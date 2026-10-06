import './renderer.css';

const taskList  = document.getElementById('task-list')
const emptyState = document.getElementById('empty-state')
const taskCount  = document.getElementById('task-count')
const btnAdd     = document.getElementById('btn-add')
const btnOpen    = document.getElementById('btn-open')   // NEW in v3
const btnSave    = document.getElementById('btn-save')   // NEW in v3

const filterBtns = document.querySelectorAll('.filter-btn');

console.log('Main window renderer loaded')

// Module-level task array — populated over IPC (same as v2)
const tasks = []

let activeFilter = 'all';

// ── Render helpers ────────────────────────────────────────────────────────────

const PRIORITY_CLASS = { High: 'priority-high', Medium: 'priority-medium', Low: 'priority-low' };
const STATUS_CLASS   = { 'To Do': 'status-todo', 'In Progress': 'status-progress', Done: 'status-done' };

function renderTasks() {
  const visible = activeFilter === 'all'
    ? tasks
    : tasks.filter(t => t.status === activeFilter);

  taskList.innerHTML = '';

  if (visible.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    visible.forEach(task => taskList.appendChild(createTaskCard(task)));
  }

  taskCount.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
}

function createTaskCard(task) {
  const li = document.createElement('li');
  li.className = 'task-card';
  li.dataset.id    = task.id;
  li.dataset.title = task.title;  // NEW in v3 — used by contextmenu listener

  li.innerHTML = `
    <div class="task-main">
      <span class="task-title">${escapeHtml(task.title)}</span>
      <div class="task-badges">
        <span class="badge ${PRIORITY_CLASS[task.priority]}">${task.priority}</span>
        <span class="badge ${STATUS_CLASS[task.status]}">${task.status}</span>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-action btn-edit"   data-action="edit"   data-id="${task.id}">Edit</button>
      <button class="btn-action btn-delete" data-action="delete" data-id="${task.id}">Delete</button>
    </div>
  `;

  return li;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Filter buttons (same as v2) ───────────────────────────────────────────────
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderTasks();
  });
});

// ── Add Task button (same as v2) ──────────────────────────────────────────────
btnAdd.addEventListener('click', () => {
  window.taskAPI.openAddWindow();
});

// ── NEW in v3 — File dialog buttons ──────────────────────────────────────────
btnOpen.addEventListener('click', () => window.taskAPI.openFile());
btnSave.addEventListener('click', () => window.taskAPI.saveFile());

// ── NEW in v3 — Event delegation for Edit / Delete buttons ───────────────────
// One listener on the parent <ul> handles clicks for ALL cards —
// even cards that were added to the DOM after this listener was attached.
// e.target.closest() walks up from the clicked element to find the [data-action].
taskList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const taskId = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'edit') {
    window.taskAPI.openEditWindow(taskId);
  }

  if (action === 'delete') {
    // Confirmation dialog runs in main via dialog.showMessageBox —
    // the renderer cannot call it directly (dialog is main-process only).
    await window.taskAPI.deleteTask(taskId);
    // No need to re-render here: main calls pushTasksToRenderer()
    // which triggers onTasksUpdated → renderTasks() below.
  }
});

// ── NEW in v3 — Right-click context menu ─────────────────────────────────────
// The renderer cannot call Menu.buildFromTemplate.
// We send the task id and title to main via IPC; main builds and pops up the menu.
taskList.addEventListener('contextmenu', (e) => {
  e.preventDefault();   // suppress the browser default context menu
  const card = e.target.closest('.task-card');
  if (!card) return;
  window.taskAPI.showTaskContextMenu(Number(card.dataset.id), card.dataset.title);
});

// ── IPC — listen for task list updates from main (same as v2) ────────────────
window.taskAPI.onTasksUpdated((updatedTasks) => {
  tasks.splice(0, tasks.length, ...updatedTasks);
  renderTasks();
});

// ── Load initial data (same as v2) ───────────────────────────────────────────
(async () => {
  const initialTasks = await window.taskAPI.getTasks();
  tasks.splice(0, tasks.length, ...initialTasks);
  renderTasks();
  console.log('[renderer] Initial tasks loaded via IPC:', tasks.length);
})();

console.log('[renderer] Main window renderer loaded. window.taskAPI:', window.taskAPI);
