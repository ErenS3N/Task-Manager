import './add.css';

const form        = document.getElementById('add-form');
const titleInput  = document.getElementById('task-title');
const titleError  = document.getElementById('title-error');
const btnCancel   = document.getElementById('btn-cancel');
const savedNotice = document.getElementById('saved-notice');

titleInput.focus();

//UPDATED CODE - add Async because we need to use await inside the submit handler
form.addEventListener('submit', async(e) => {
  e.preventDefault();

  const title    = titleInput.value.trim();
  const priority = document.getElementById('task-priority').value;
  const status   = document.getElementById('task-status').value;

  if (!title) {
    titleError.hidden = false;
    titleInput.focus();
    return;
  }
  titleError.hidden = true;

  /* BEGIN OF CODE UPDATE */

  // Disable the save button while the IPC call is in flight
  const btnSave = document.getElementById('btn-save');
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';
 
  try {
    // Send the task to main.js — invoke returns the saved task object
    await window.taskAPI.addTask({ title, priority, status });
    // console.log('[add-window] Task saved:', saved);
 
    // Show the success state only after main confirms the task was saved.
    form.hidden = true;
    savedNotice.hidden = false;

    // Close this window after the acknowledgement is visible.
    setTimeout(() => window.taskAPI.closeWindow(), 800);
 
  } catch (err) {
    console.error('[add-window] Failed to save task:', err);
    btnSave.disabled = false;
    btnSave.textContent = 'Save Task';
  }
  /* END OF CODE UPDATE */
});


btnCancel.addEventListener('click', () => window.close());

titleInput.addEventListener('input', () => {
  if (titleInput.value.trim()) titleError.hidden = true;
});

console.log('[add-window] Add window renderer loaded. This is renderer process #2.');