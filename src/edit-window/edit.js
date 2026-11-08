// Reuse the same CSS as the add window (dark theme, identical form layout)
import '../add-window/add.css';

const form       = document.getElementById('edit-form');
const titleInput = document.getElementById('task-title');
const titleError = document.getElementById('title-error');
const btnCancel  = document.getElementById('btn-cancel');


let currentTaskId = null;   

// ── Pre-fill the form with the existing task data ─────────────────────────────
window.taskAPI.onLoadTask((task) => {
  currentTaskId = task.id;  // store it here
  titleInput.value = task.title;
  document.getElementById('task-priority').value = task.priority;
  document.getElementById('task-status').value   = task.status;
  document.getElementById('task-notes').value    = task.notes ?? '';
  titleInput.focus();
  titleInput.select();
});

// ── Save changes ──────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = titleInput.value.trim();
  if (!title) {
    titleError.hidden = false;
    titleInput.focus();
    return;
  }
  titleError.hidden = true;

  const btnSave = document.getElementById('btn-save');
  btnSave.disabled    = true;
  btnSave.textContent = 'Saving…';

  try {
    await window.taskAPI.updateTask({
      id:       currentTaskId,
      title,
      priority: document.getElementById('task-priority').value,
      status:   document.getElementById('task-status').value,
      notes:    document.getElementById('task-notes').value
    });

    // Main has updated the task and called pushTasksToRenderer();
    // close this window so the user sees the updated list.
    setTimeout(() => window.taskAPI.closeWindow(), 200);

  } catch (err) {
    console.error('[edit-window] Failed to update task:', err);
    btnSave.disabled    = false;
    btnSave.textContent = 'Save Changes';
  }
});

btnCancel.addEventListener('click', () => window.taskAPI.closeWindow());

titleInput.addEventListener('input', () => {
  if (titleInput.value.trim()) titleError.hidden = true;
});

console.log('[edit-window] Edit window renderer loaded.');
