import { getAll, getByIndex, put, remove, getById } from '../db/idb.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { emit } from '../utils/eventbus.js';
import { debounce } from '../utils/debounce.js';
import { friendlyDate, daysUntil } from '../utils/date.js';
import { makeSortable } from '../utils/drag.js';

function uuid() { return crypto.randomUUID(); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const GOAL_COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#facc15', '#94a3b8'];

let allGoals = [];
let allTasks = {};
let activeId = null;
let filterStatus = 'active';

export async function render(container, state = {}) {
  if (state.openId) activeId = state.openId;
  allGoals = await getAll('goals');
  const tasks = await getAll('tasks');
  allTasks = {};
  tasks.forEach(t => {
    if (!allTasks[t.goalId]) allTasks[t.goalId] = [];
    allTasks[t.goalId].push(t);
  });

  container.innerHTML = `
    <div class="two-panel">
      <div class="panel-left">
        <div class="goals-list-header">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Goals</span>
            <button class="btn btn-primary" id="new-goal-btn" style="font-size:12px;padding:4px 10px">+ New Goal</button>
          </div>
          <select id="goal-filter" style="width:100%">
            <option value="all">All Goals</option>
            <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>Active</option>
            <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="paused" ${filterStatus === 'paused' ? 'selected' : ''}>Paused</option>
          </select>
        </div>
        <div class="panel-list" id="goals-list"></div>
      </div>
      <div class="panel-right" id="goal-detail-pane">
        <div class="empty-state">
          <div class="empty-icon">◎</div>
          <div class="empty-title">Select a goal</div>
          <div class="empty-desc">Pick a goal to view details and tasks, or create a new one.</div>
        </div>
      </div>
    </div>
  `;

  renderGoalList(container);

  container.querySelector('#new-goal-btn').addEventListener('click', () => createGoal(container));
  container.querySelector('#goal-filter').addEventListener('change', e => {
    filterStatus = e.target.value;
    renderGoalList(container);
  });

  if (activeId) openGoal(container, activeId);
}

function renderGoalList(container) {
  const list = container.querySelector('#goals-list');
  if (!list) return;

  const filtered = allGoals.filter(g => filterStatus === 'all' || g.status === filterStatus);

  // Sort: by order if all have it, else by targetDate/createdAt
  const hasOrder = filtered.length > 0 && filtered.every(g => g.order !== undefined && g.order !== null);
  filtered.sort((a, b) => {
    if (hasOrder) return (a.order || 0) - (b.order || 0);
    return (a.targetDate || '').localeCompare(b.targetDate || '') || (b.createdAt || 0) - (a.createdAt || 0);
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-desc">No ${filterStatus === 'all' ? '' : filterStatus + ' '}goals yet</div></div>`;
    return;
  }

  list.innerHTML = filtered.map(g => {
    const tasks = allTasks[g.id] || [];
    const progress = calcProgress(tasks);
    return `
      <div class="goal-item ${g.id === activeId ? 'active' : ''}" data-id="${g.id}" draggable="true">
        <div class="goal-item-header">
          <div class="goal-color-dot" style="background:${g.color || 'var(--accent)'}"></div>
          <div class="goal-item-title">${esc(g.title || 'Untitled Goal')}</div>
          <div class="goal-item-progress-text">${progress}%</div>
        </div>
        ${g.category ? `<div class="goal-item-category">${esc(g.category)}</div>` : ''}
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span class="goal-status-badge goal-status-${g.status}">${g.status}</span>
          ${g.targetDate ? `<span class="goal-item-target">${targetDateLabel(g.targetDate)}</span>` : ''}
          <span style="font-size:11px;color:var(--text-3);margin-left:auto">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.goal-item').forEach(el => {
    el.addEventListener('click', () => openGoal(container, el.dataset.id));
  });

  // Drag to reorder
  makeSortable(list, '.goal-item', async (ordered) => {
    ordered.forEach((el, i) => {
      const g = allGoals.find(g => g.id === el.dataset.id);
      if (g) g.order = i;
    });
    for (const el of ordered) {
      const g = allGoals.find(g => g.id === el.dataset.id);
      if (g) await put('goals', g);
    }
  });
}

function calcProgress(tasks) {
  if (!tasks || tasks.length === 0) return 0;
  const done = tasks.filter(t => t.done).length;
  return Math.round((done / tasks.length) * 100);
}

function targetDateLabel(isoDate) {
  if (!isoDate) return '';
  const days = daysUntil(isoDate);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

async function createGoal(container) {
  const goal = {
    id:          uuid(),
    title:       '',
    description: '',
    category:    '',
    targetDate:  '',
    status:      'active',
    progress:    0,
    color:       GOAL_COLORS[0],
    dashPinned:  false,
    order:       allGoals.length,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
  await put('goals', goal);
  allGoals.unshift(goal);
  allTasks[goal.id] = [];
  activeId = goal.id;
  renderGoalList(container);
  openGoal(container, goal.id);
  emit('goal-saved', goal);
}

async function openGoal(container, id) {
  activeId = id;
  renderGoalList(container);

  const goal = allGoals.find(g => g.id === id) || await getById('goals', id);
  if (!goal) return;

  const tasks = allTasks[id] || await getByIndex('tasks', 'goalId', id);
  allTasks[id] = tasks;
  tasks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const pane = container.querySelector('#goal-detail-pane');
  pane.innerHTML = '';

  // Title
  const titleInput = document.createElement('input');
  titleInput.className = 'goal-editor-title';
  titleInput.placeholder = 'Goal title…';
  titleInput.value = goal.title || '';
  pane.appendChild(titleInput);

  // Progress display
  const progressSection = document.createElement('div');
  progressSection.className = 'goal-progress-display';
  progressSection.innerHTML = `
    <div class="goal-progress-pct" id="goal-pct-display">${calcProgress(tasks)}%</div>
    <div class="goal-progress-bar-wrap">
      <div class="progress-bar" style="height:10px">
        <div class="progress-bar-fill" id="goal-pct-bar" style="width:${calcProgress(tasks)}%"></div>
      </div>
      <div class="goal-progress-label" id="goal-task-stats">${tasks.filter(t => t.done).length}/${tasks.length} tasks completed</div>
    </div>
  `;
  pane.appendChild(progressSection);

  // Actions
  const actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center';
  actRow.innerHTML = `
    <button class="btn btn-ghost" id="goal-dash-pin-btn" style="font-size:12px">${goal.dashPinned ? '★ On Dashboard' : '☆ Pin to Dashboard'}</button>
    <button class="btn btn-danger" id="del-goal-btn" style="font-size:12px">Delete</button>
    <span id="goal-save-ind" style="font-size:11px;color:var(--text-3);margin-left:auto"></span>
  `;
  pane.appendChild(actRow);

  // Meta form
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row" style="margin-bottom:16px">
      <div class="form-group">
        <label>Status</label>
        <select id="goal-status">
          <option value="active" ${goal.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="completed" ${goal.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="paused" ${goal.status === 'paused' ? 'selected' : ''}>Paused</option>
        </select>
      </div>
      <div class="form-group">
        <label>Target Date</label>
        <input type="date" id="goal-target" value="${goal.targetDate || ''}"/>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:16px">
      <div class="form-group">
        <label>Category</label>
        <input type="text" id="goal-category" value="${esc(goal.category || '')}" placeholder="e.g. Revenue, Product…"/>
      </div>
      <div class="form-group">
        <label>Color</label>
        <div class="color-picker-row" id="goal-colors">
          ${GOAL_COLORS.map(c => `<span class="color-swatch ${goal.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:20px">
      <label>Description</label>
      <textarea id="goal-desc" rows="3" placeholder="Describe this goal…" style="resize:vertical">${esc(goal.description || '')}</textarea>
    </div>
  `;
  pane.appendChild(form);

  let selectedColor = goal.color || GOAL_COLORS[0];
  form.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      form.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
      goal.color = selectedColor;
      save();
    });
  });

  // Tasks section
  const tasksSection = document.createElement('div');
  tasksSection.innerHTML = `
    <div class="tasks-header">
      <div class="section-title" style="margin:0">Tasks</div>
    </div>
  `;
  pane.appendChild(tasksSection);

  const taskListEl = document.createElement('div');
  taskListEl.id = 'task-list';
  pane.appendChild(taskListEl);

  renderTasks(taskListEl, tasks, goal, pane, container);

  const saveInd = actRow.querySelector('#goal-save-ind');
  const debouncedSave = debounce(save, 600);

  titleInput.addEventListener('input', () => { goal.title = titleInput.value; debouncedSave(); });
  form.querySelector('#goal-status').addEventListener('change', e => { goal.status = e.target.value; save(); renderGoalList(container); });
  form.querySelector('#goal-target').addEventListener('change', e => { goal.targetDate = e.target.value; save(); });
  form.querySelector('#goal-category').addEventListener('input', e => { goal.category = e.target.value; debouncedSave(); });
  form.querySelector('#goal-desc').addEventListener('input', e => { goal.description = e.target.value; debouncedSave(); });

  actRow.querySelector('#goal-dash-pin-btn').addEventListener('click', async () => {
    goal.dashPinned = !goal.dashPinned;
    actRow.querySelector('#goal-dash-pin-btn').textContent = goal.dashPinned ? '★ On Dashboard' : '☆ Pin to Dashboard';
    await save();
  });

  actRow.querySelector('#del-goal-btn').addEventListener('click', () => {
    modal.confirm({
      title: 'Delete goal',
      message: `Delete "<strong>${esc(goal.title || 'Untitled')}</strong>" and all its tasks?`,
      onConfirm: async () => {
        await remove('goals', goal.id);
        // Delete all tasks
        for (const t of (allTasks[goal.id] || [])) await remove('tasks', t.id);
        allGoals = allGoals.filter(g => g.id !== goal.id);
        delete allTasks[goal.id];
        activeId = null;
        renderGoalList(container);
        pane.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div><div class="empty-title">Goal deleted</div></div>`;
        toast('Goal deleted', 'info');
        emit('goal-saved', null);
      },
    });
  });

  async function save() {
    goal.title       = titleInput.value;
    goal.description = form.querySelector('#goal-desc').value;
    goal.category    = form.querySelector('#goal-category').value;
    goal.targetDate  = form.querySelector('#goal-target').value;
    goal.status      = form.querySelector('#goal-status').value;
    goal.color       = selectedColor;
    goal.progress    = calcProgress(allTasks[goal.id] || []);
    goal.updatedAt   = Date.now();
    await put('goals', goal);
    const idx = allGoals.findIndex(g => g.id === goal.id);
    if (idx > -1) allGoals[idx] = goal; else allGoals.unshift(goal);
    if (saveInd) { saveInd.textContent = 'Saved'; setTimeout(() => { if (saveInd) saveInd.textContent = ''; }, 1500); }
    updateProgressDisplay(pane, allTasks[goal.id] || []);
    emit('goal-saved', goal);
    renderGoalList(container);
  }
}

function updateProgressDisplay(pane, tasks) {
  const pct = calcProgress(tasks);
  const pctEl = pane.querySelector('#goal-pct-display');
  const barEl = pane.querySelector('#goal-pct-bar');
  const statsEl = pane.querySelector('#goal-task-stats');
  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) barEl.style.width = pct + '%';
  if (statsEl) statsEl.textContent = `${tasks.filter(t => t.done).length}/${tasks.length} tasks completed`;
}

function renderTasks(listEl, tasks, goal, pane, container) {
  listEl.innerHTML = '';

  tasks.forEach((task, i) => {
    const item = document.createElement('div');
    item.className = 'task-item' + (task.done ? ' done' : '');
    item.dataset.id = task.id;
    item.innerHTML = `
      <div class="task-checkbox" data-check="${task.id}">${task.done ? '✓' : ''}</div>
      <input class="task-title" value="${esc(task.title)}" placeholder="Task…"/>
      <select class="task-priority-select" data-priority="${task.id}">
        <option value="high" ${task.priority === 'high' ? 'selected' : ''}>● High</option>
        <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>● Med</option>
        <option value="low" ${task.priority === 'low' ? 'selected' : ''}>● Low</option>
      </select>
      ${task.dueDate ? `<span class="task-due">${task.dueDate}</span>` : ''}
      <button class="task-delete-btn" data-del="${task.id}">✕</button>
    `;

    // Checkbox toggle
    item.querySelector('.task-checkbox').addEventListener('click', async () => {
      task.done = !task.done;
      await put('tasks', task);
      item.classList.toggle('done', task.done);
      item.querySelector('.task-checkbox').textContent = task.done ? '✓' : '';
      updateProgressDisplay(pane, tasks);
      goal.progress = calcProgress(tasks);
      goal.updatedAt = Date.now();
      await put('goals', goal);
      emit('goal-saved', goal);
      renderGoalList(container);
    });

    // Title edit
    const titleInp = item.querySelector('.task-title');
    const debouncedTaskSave = debounce(async () => {
      task.title = titleInp.value;
      await put('tasks', task);
    }, 600);
    titleInp.addEventListener('input', debouncedTaskSave);

    // Priority
    item.querySelector('.task-priority-select').addEventListener('change', async e => {
      task.priority = e.target.value;
      await put('tasks', task);
    });

    // Delete
    item.querySelector('.task-delete-btn').addEventListener('click', async () => {
      await remove('tasks', task.id);
      allTasks[goal.id] = (allTasks[goal.id] || []).filter(t => t.id !== task.id);
      tasks.splice(tasks.indexOf(task), 1);
      item.remove();
      updateProgressDisplay(pane, tasks);
      goal.progress = calcProgress(tasks);
      await put('goals', goal);
      emit('goal-saved', goal);
      renderGoalList(container);
    });

    listEl.appendChild(item);
  });

  // Add task row
  const addRow = document.createElement('div');
  addRow.className = 'add-task-row';
  addRow.innerHTML = `
    <span>+</span>
    <input class="add-task-input" placeholder="Add a task… (Enter to save)"/>
    <select class="task-priority-select" id="new-task-priority">
      <option value="medium">Med</option>
      <option value="high">High</option>
      <option value="low">Low</option>
    </select>
  `;

  const addInput = addRow.querySelector('.add-task-input');
  addInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      const task = {
        id:       uuid(),
        goalId:   goal.id,
        title:    addInput.value.trim(),
        done:     false,
        dueDate:  '',
        priority: addRow.querySelector('#new-task-priority').value,
        createdAt: Date.now(),
      };
      await put('tasks', task);
      if (!allTasks[goal.id]) allTasks[goal.id] = [];
      allTasks[goal.id].push(task);
      tasks.push(task);
      addInput.value = '';
      renderTasks(listEl, tasks, goal, pane, container);
      updateProgressDisplay(pane, tasks);
      goal.progress = calcProgress(tasks);
      goal.updatedAt = Date.now();
      await put('goals', goal);
      emit('goal-saved', goal);
      renderGoalList(container);
    }
  });

  listEl.appendChild(addRow);
}
