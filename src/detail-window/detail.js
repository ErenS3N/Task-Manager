const taskId = Number(new URLSearchParams(window.location.search).get('taskId'));

function renderTask(task) {
  document.getElementById('detail-title').textContent = task.title;
  document.getElementById('detail-priority').textContent = task.priority;
  document.getElementById('detail-status').textContent = task.status;
  document.getElementById('detail-created').textContent =
    new Date(task.createdAt).toLocaleString();
  document.getElementById('detail-updated').textContent =
    new Date(task.updatedAt).toLocaleString();
  document.getElementById('detail-notes').textContent = task.notes;
}

if (!Number.isSafeInteger(taskId) || taskId <= 0) {
  window.close();
} else {
  window.taskAPI.onTasksUpdated((updatedTasks) => {
    const task = updatedTasks.find((item) => item.id === taskId);

    if (!task) {
      window.close();
      return;
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