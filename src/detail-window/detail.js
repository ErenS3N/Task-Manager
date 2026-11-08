const taskId = Number(new URLSearchParams(window.location.search).get('taskId'));
const notesDisplay = document.getElementById('detail-notes');
const editNotesButton = document.getElementById('btn-edit-notes');
const notesEditor = document.getElementById('notes-editor');
const notesInput = document.getElementById('notes-input');
const notesError = document.getElementById('notes-error');
const saveNotesButton = document.getElementById('btn-save-notes');
const cancelNotesButton = document.getElementById('btn-cancel-notes');

let currentTask = null;

function renderTask(task) {
  currentTask = task;
  document.getElementById('detail-title').textContent = task.title;
  document.getElementById('detail-priority').textContent = task.priority;
  document.getElementById('detail-status').textContent = task.status;
  document.getElementById('detail-created').textContent =
    new Date(task.createdAt).toLocaleString();
  document.getElementById('detail-updated').textContent =
    new Date(task.updatedAt).toLocaleString();
  document.getElementById('detail-notes').textContent = task.notes;
}

function closeNotesEditor() {
  notesEditor.hidden = true;
  notesDisplay.hidden = false;
  editNotesButton.hidden = false;
  notesError.hidden = true;
}

editNotesButton.addEventListener('click', () => {
  if (!currentTask) return;
  notesInput.value = currentTask.notes;
  notesError.hidden = true;
  notesDisplay.hidden = true;
  editNotesButton.hidden = true;
  notesEditor.hidden = false;
  notesInput.focus();
});

cancelNotesButton.addEventListener('click', closeNotesEditor);

saveNotesButton.addEventListener('click', async () => {
  saveNotesButton.disabled = true;
  notesError.hidden = true;

  try {
    const savedTask = await window.taskAPI.updateNotes(taskId, notesInput.value);
    if (!savedTask) {
      notesError.textContent = 'Notes must be 500 characters or fewer.';
      notesError.hidden = false;
      return;
    }

    renderTask(savedTask);
    closeNotesEditor();
  } catch (error) {
    notesError.textContent = 'Could not save notes.';
    notesError.hidden = false;
    console.error(error);
  } finally {
    saveNotesButton.disabled = false;
  }
});

if (!Number.isSafeInteger(taskId) || taskId <= 0) {
  window.close();
} else {
  window.taskAPI.onTasksUpdated((updatedTasks) => {
    const task = updatedTasks.find((item) => item.id === taskId);

    if (!task) {
      window.close();
      return;
    }

    const notesChanged = currentTask && task.notes !== currentTask.notes;

    if (notesChanged && !notesEditor.hidden) {
      closeNotesEditor();
    }

    renderTask(task);
  });

  window.taskAPI.getDetail(taskId)
    .then((task) => {
      if (!task) {
        window.close();
        return;
      }

      renderTask(task);
    })
    .catch((error) => console.error('Failed to load task details:', error));
}