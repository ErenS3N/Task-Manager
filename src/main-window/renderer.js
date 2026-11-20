import './renderer.css';

const taskList  = document.getElementById('task-list')
const taskListArea = document.querySelector('.task-list-area')
const emptyState = document.getElementById('empty-state')
const taskCount  = document.getElementById('task-count')
const btnAdd     = document.getElementById('btn-add')
const btnOpen    = document.getElementById('btn-open')   // NEW in v3
const btnSave    = document.getElementById('btn-save')   // NEW in v3
const btnClearAll = document.getElementById('btn-clear-all')
const updateNotice = document.getElementById('update-notice')
const updateMessage = document.getElementById('update-message')
const updateInstall = document.getElementById('btn-update-install')

const filterBtns = document.querySelectorAll('.filter-btn');

console.log('Main window renderer loaded')

const taskLayout = getComputedStyle(document.documentElement);
const TASK_CARD_HEIGHT = parseFloat(taskLayout.getPropertyValue('--task-card-height'));
const TASK_CARD_GAP = parseFloat(taskLayout.getPropertyValue('--task-card-gap'));
const TASK_ROW_HEIGHT = TASK_CARD_HEIGHT + TASK_CARD_GAP;
const TASK_OVERSCAN = 8;
const LIST_PADDING_TOP = parseFloat(getComputedStyle(taskListArea).paddingTop);
const LIST_PADDING_BOTTOM = parseFloat(getComputedStyle(taskListArea).paddingBottom);

function renderUpdateState(state) {
  if (state?.status === 'available') {
    updateNotice.dataset.state = 'available';
    updateMessage.textContent = 'An update is available. Downloading in the background.';
    updateInstall.hidden = true;
    updateNotice.hidden = false;
    return;
  }

  if (state?.status === 'downloaded') {
    updateNotice.dataset.state = 'downloaded';
    updateMessage.textContent = 'An update is ready to install.';
    updateInstall.hidden = false;
    updateNotice.hidden = false;
    return;
  }

  updateNotice.hidden = true;
  updateInstall.hidden = true;
}

window.taskAPI.onUpdateState(renderUpdateState);
window.taskAPI.getUpdateState().then(renderUpdateState);
updateInstall.addEventListener('click', () => window.taskAPI.installUpdate());

let activeStatusFilter = 'all';
let activePriorityFilter = 'All';
const hoverAnimSuppressedUntil = new Map();
const HOVER_SUPPRESS_MS = 260;
let filteredTasks = [];
let renderScheduled = false;

// ── Render helpers ────────────────────────────────────────────────────────────

const PRIORITY_CLASS = { High: 'priority-high', Medium: 'priority-medium', Low: 'priority-low' };
const STATUS_CLASS   = { 'To Do': 'status-todo', 'In Progress': 'status-progress', Done: 'status-done' };

function renderTasks(allTasks) {
  const sourceTasks = Array.isArray(allTasks) ? allTasks : [];

  filteredTasks = sourceTasks.filter((t) => {
    const matchesStatus = activeStatusFilter === 'all' || t.status === activeStatusFilter;
    const matchesPriority = activePriorityFilter === 'All' || t.priority === activePriorityFilter;
    return matchesStatus && matchesPriority;
  });

  emptyState.hidden = filteredTasks.length !== 0;
  taskCount.textContent = `${sourceTasks.length} task${sourceTasks.length === 1 ? '' : 's'}`;
  renderVisibleTasks();
}

function renderVisibleTasks() {
  const totalListHeight = filteredTasks.length * TASK_ROW_HEIGHT - (filteredTasks.length ? TASK_CARD_GAP : 0);
  const maxScrollTop = Math.max(
    0,
    LIST_PADDING_TOP + totalListHeight + LIST_PADDING_BOTTOM - taskListArea.clientHeight
  );
  taskListArea.scrollTop = Math.min(taskListArea.scrollTop, maxScrollTop);

  const scrollOffset = Math.max(0, taskListArea.scrollTop - LIST_PADDING_TOP);
  const firstVisibleIndex = Math.floor(scrollOffset / TASK_ROW_HEIGHT);
  const start = Math.max(0, firstVisibleIndex - TASK_OVERSCAN);
  const end = Math.min(
    filteredTasks.length,
    Math.ceil((scrollOffset + taskListArea.clientHeight) / TASK_ROW_HEIGHT) + TASK_OVERSCAN
  );

  taskList.style.paddingTop = `${start * TASK_ROW_HEIGHT}px`;
  taskList.style.paddingBottom = `${(filteredTasks.length - end) * TASK_ROW_HEIGHT}px`;

  const cards = [];
  for (let index = start; index < end; index += 1) {
    const card = createTaskCard(filteredTasks[index]);
    card.setAttribute('aria-setsize', String(filteredTasks.length));
    card.setAttribute('aria-posinset', String(index + 1));
    cards.push(card);
  }
  taskList.replaceChildren(...cards);
}

function scheduleVisibleTaskRender() {
  if (renderScheduled) return;

  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderVisibleTasks();
  });
}

async function renderLatestTasks() {
  const latestTasks = await window.taskAPI.getTasks();
  renderTasks(latestTasks);
}

function createTaskCard(task) {
  const statusOrder = ['To Do', 'In Progress', 'Done'];
  const nextStatus = statusOrder[(statusOrder.indexOf(task.status) + 1) % statusOrder.length];
  const now = Date.now();
  const suppressUntil = hoverAnimSuppressedUntil.get(task.id) || 0;

  const li = document.createElement('li');
  li.className = 'task-card';
  if (now < suppressUntil) {
    li.classList.add('no-hover-anim');
  } else if (suppressUntil !== 0) {
    hoverAnimSuppressedUntil.delete(task.id);
  }
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
      <button class="btn-action btn-cycle"  data-action="cycle"  data-id="${task.id}">→ ${nextStatus}</button>
      <button class="btn-action btn-edit"   data-action="edit"   data-id="${task.id}">Edit</button>
      <button class="btn-action btn-detail" data-action="detail" data-id="${task.id}">Detail</button>
      <button class="btn-action btn-delete" data-action="delete" data-id="${task.id}">Delete</button>
    </div>
  `;

  return li;
}

taskListArea.addEventListener('scroll', scheduleVisibleTaskRender, { passive: true });
new ResizeObserver(scheduleVisibleTaskRender).observe(taskListArea);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Filter buttons (same as v2) ───────────────────────────────────────────────
filterBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeStatusFilter = btn.dataset.filter;
    window.taskAPI.saveFilter(activeStatusFilter);
    await renderLatestTasks();
  });
});

window.taskAPI.onPriorityFilter(async (priority) => {
  console.log(`[renderer] 'tasks:filter' ->`, priority);
  activePriorityFilter = priority;
  activeStatusFilter = 'all';
  filterBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });
  await renderLatestTasks();
});

window.taskAPI.onStatusFilterRestored(async (filter) => {
  activeStatusFilter = filter;
  filterBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  await renderLatestTasks();
});

// ── Add Task button (same as v2) ──────────────────────────────────────────────
btnAdd.addEventListener('click', () => {
  window.taskAPI.openAddWindow();
});

// ── NEW in v3 — File dialog buttons ──────────────────────────────────────────
btnOpen.addEventListener('click', () => window.taskAPI.openFile());
btnSave.addEventListener('click', () => window.taskAPI.saveFile());
btnClearAll.addEventListener('click', () => window.taskAPI.clearAllTasks());

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

  if (action === 'detail') {
    window.taskAPI.openDetailWindow(taskId);
  }

  if (action === 'cycle') {
    hoverAnimSuppressedUntil.set(taskId, Date.now() + HOVER_SUPPRESS_MS);
    await window.taskAPI.cycleStatus(taskId);
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
  renderTasks(updatedTasks);
});

// ── Load initial data (same as v2) ───────────────────────────────────────────
(async () => {
  const initialTasks = await window.taskAPI.getTasks();
  renderTasks(initialTasks);
  console.log('[renderer] Initial tasks loaded via IPC:', initialTasks.length);
})();

console.log('[renderer] Main window renderer loaded. window.taskAPI:', window.taskAPI);
