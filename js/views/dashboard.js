import { getAll, put } from '../db/idb.js';
import { getBookmarkData, getWidgetConfig, saveWidgetConfig } from '../db/storage.js';
import { todayISO, toISODate } from '../utils/date.js';
import { navigate } from '../router.js';
import { on, off, emit } from '../utils/eventbus.js';
import { makeSortable } from '../utils/drag.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';

function uuid() { return crypto.randomUUID(); }

let _clockTimer = null;
let _handlers = {};
let _isEditMode = false;

// ── Events widget pref ────────────────────────────────────────────────────────
const EVENTS_PREF_DEFAULT = { showTomorrow: true, showAll: false };

function getEventsWidgetPref() {
  return new Promise(res => chrome.storage.local.get({ eventsWidgetPref: EVENTS_PREF_DEFAULT }, r => res(r.eventsWidgetPref)));
}

function saveEventsWidgetPref(pref) {
  return new Promise(res => chrome.storage.local.set({ eventsWidgetPref: pref }, res));
}

function getTomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

function filterEventsForWidget(pref, eventsList) {
  const today = todayISO();
  const sorted = [...eventsList].sort((a, b) =>
    (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || ''))
  );
  if (pref.showAll) {
    return sorted.filter(e => e.date >= today || e.dashPinned).slice(0, 10);
  }
  const endDate = pref.showTomorrow ? getTomorrowISO() : today;
  return sorted.filter(e => (e.date >= today && e.date <= endDate) || e.dashPinned);
}

export async function render(container, state = {}) {
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
  for (const [ev, fn] of Object.entries(_handlers)) off(ev, fn);
  _handlers = {};
  _isEditMode = false;

  const today = todayISO();
  const upcomingDate = new Date();
  upcomingDate.setDate(upcomingDate.getDate() + 7);
  const upcomingISO = toISODate(upcomingDate);

  const [allNotes, allEvents, allGoals, { bookmarks }, widgets, eventsPref] = await Promise.all([
    getAll('notes'),
    getAll('events'),
    getAll('goals'),
    getBookmarkData(),
    getWidgetConfig(),
    getEventsWidgetPref(),
  ]);

  const pinnedNotes      = allNotes.filter(n => n.pinned === true);
  const activeGoals      = allGoals.filter(g => g.status === 'active' || g.dashPinned === true);
  const upcomingMeetings = allEvents
    .filter(e => e.type === 'meeting' && ((e.date >= today && e.date <= upcomingISO) || e.dashPinned === true))
    .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));

  const allEventsList  = allEvents.filter(e => e.type === 'event');
  const upcomingEvents = filterEventsForWidget(eventsPref, allEventsList);

  const sortedWidgets = [...widgets].sort((a, b) => (a.order || 0) - (b.order || 0));
  const data = { pinnedNotes, activeGoals, todayEvents: upcomingEvents, allEventsList, eventsPref, todayMeetings: upcomingMeetings, bookmarks };

  container.innerHTML = `<div class="dashboard-layout"><div id="dash-widgets"></div></div>`;
  injectDashboardStyles();

  renderWidgets(container, widgets, sortedWidgets, data);

  const rerender = () => {
    if (container.querySelector('.dashboard-layout')) render(container);
  };
  _handlers['note-saved'] = rerender;
  _handlers['goal-saved'] = rerender;
  _handlers['event-saved'] = rerender;
  on('note-saved', rerender);
  on('goal-saved', rerender);
  on('event-saved', rerender);
}

function renderWidgets(container, allWidgets, sortedWidgets, data) {
  const area = container.querySelector('#dash-widgets');
  if (!area) return;
  area.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'dash-unified-grid';
  grid.id = 'dash-widgets-grid';
  area.appendChild(grid);

  const enabled = sortedWidgets.filter(w => w.enabled);
  enabled.forEach(w => {
    const block = buildWidgetBlock(w, data);
    if (!block) return;
    block.dataset.id = w.id;
    block.dataset.wid = w.id;
    grid.appendChild(block);
  });

  if (grid.children.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:32px">
      <div class="empty-icon">⊞</div>
      <div class="empty-title">No widgets visible</div>
      <div class="empty-desc">Add the Clock widget and others via Customize.</div>
    </div>`;
    return;
  }

  // Attach clock timer
  const timeEl = grid.querySelector('#dash-time');
  const dateEl = grid.querySelector('#dash-date');
  if (timeEl && dateEl) {
    function tick() {
      const n = new Date();
      timeEl.textContent = n.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
      dateEl.textContent = n.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    tick();
    _clockTimer = setInterval(tick, 1000);
  }

  // Clock action buttons
  grid.querySelector('#dash-customize-btn')?.addEventListener('click', () => {
    showCustomizePanel(container, allWidgets, data);
  });
  grid.querySelector('#dash-edit-layout-btn')?.addEventListener('click', () => {
    activateEditMode(grid, allWidgets, container);
  });
}

function buildWidgetBlock(widget, data) {
  const block = document.createElement('div');
  block.className = 'dash-widget-block';

  if (widget.id === 'clock') {
    block.classList.add('dash-widget-full');
    block.innerHTML = `
      <div class="dashboard-clock-section">
        <div class="dashboard-time" id="dash-time"></div>
        <div class="dashboard-date" id="dash-date"></div>
        <div class="dash-clock-btns">
          <button class="btn btn-ghost" id="dash-customize-btn" style="font-size:12px">⚙ Customize Widgets</button>
          <button class="btn btn-ghost" id="dash-edit-layout-btn" style="font-size:12px">✎ Edit Layout</button>
        </div>
      </div>
    `;
    return block;
  }

  if (widget.id === 'bookmarks') {
    block.classList.add('dash-widget-full');
    const inner = document.createElement('div');
    inner.className = 'dashboard-section';
    inner.innerHTML = `<div class="section-title">Quick Access</div><div class="dash-bookmark-row" id="dash-bookmarks"></div>`;
    renderBookmarkRow(inner.querySelector('#dash-bookmarks'), data.bookmarks);
    block.appendChild(inner);
    return block;
  }

  const meta = WIDGET_META[widget.id];
  if (!meta) return null;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="widget-card-header">
      <div class="section-title" style="margin:0">${meta.title}</div>
      <div style="display:flex;align-items:center;gap:2px">
        ${widget.id === 'events' ? `<button class="btn-icon widget-cog-btn" title="Filter settings">⚙</button>` : ''}
        <button class="btn-icon widget-add-btn" title="${meta.addTitle}">+</button>
      </div>
    </div>
    <div class="widget-body"></div>
  `;
  card.querySelector('.widget-add-btn').addEventListener('click', () => {
    if (!_isEditMode) showWidgetQuickAdd(widget.id, data);
  });

  const body = card.querySelector('.widget-body');
  if (widget.id === 'events') {
    renderEventsWidget(body, data.todayEvents);
    card.querySelector('.widget-cog-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!_isEditMode) showEventsSettingsPopover(e.currentTarget, data.eventsPref, data.allEventsList, body);
    });
  }
  if (widget.id === 'notes')    renderNotesWidget(body, data.pinnedNotes);
  if (widget.id === 'goals')    renderGoalsWidget(body, data.activeGoals);
  if (widget.id === 'meetings') renderMeetingsWidget(body, data.todayMeetings);

  block.appendChild(card);
  return block;
}

const WIDGET_META = {
  events:   { title: 'Upcoming Schedule', addTitle: 'Add event' },
  notes:    { title: 'Pinned Notes',      addTitle: 'New note' },
  goals:    { title: 'Active Goals',      addTitle: 'New goal' },
  meetings: { title: 'Upcoming Meetings', addTitle: 'Add meeting' },
};

// ── Edit Layout Mode ──────────────────────────────────────────────────────────

function activateEditMode(grid, allWidgets, container) {
  _isEditMode = true;
  grid.classList.add('editing');

  // Add overlay + drag indicator to each block
  grid.querySelectorAll('.dash-widget-block').forEach(block => {
    block.draggable = true;
    const overlay = document.createElement('div');
    overlay.className = 'dash-edit-overlay';
    block.appendChild(overlay);
  });

  // Floating save/cancel bar
  const bar = document.createElement('div');
  bar.className = 'dash-edit-bar';
  bar.id = 'dash-edit-bar';
  bar.innerHTML = `
    <span style="font-size:13px;color:var(--text-2)">✎ Drag widgets to reorder</span>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" id="dash-edit-cancel">Cancel</button>
      <button class="btn btn-primary" id="dash-edit-save">Save Layout</button>
    </div>
  `;
  document.body.appendChild(bar);

  makeSortable(grid, '.dash-widget-block', (ordered) => {
    const newOrder = ordered.map(el => el.dataset.id);
    allWidgets.forEach(w => {
      const idx = newOrder.indexOf(w.id);
      if (idx > -1) w.order = idx;
    });
  });

  bar.querySelector('#dash-edit-cancel').addEventListener('click', () => {
    bar.remove();
    _isEditMode = false;
    render(container);
  });

  bar.querySelector('#dash-edit-save').addEventListener('click', async () => {
    const ordered = [...grid.querySelectorAll('.dash-widget-block')];
    const newOrder = ordered.map(el => el.dataset.id);
    allWidgets.forEach(w => {
      const idx = newOrder.indexOf(w.id);
      if (idx > -1) w.order = idx;
    });
    await saveWidgetConfig(allWidgets);
    bar.remove();
    _isEditMode = false;
    toast('Layout saved');
    render(container);
  });
}

// ── Widget Quick Add ──────────────────────────────────────────────────────────

async function showWidgetQuickAdd(widgetId, data) {
  const today = todayISO();

  function itemListHTML(items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    return `<div class="section-title" style="margin:16px 0 8px">Current Items</div>` +
      sorted.map(item => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="width:8px;height:8px;border-radius:50%;background:${item.color||'var(--accent)'};flex-shrink:0"></span>
          <span style="font-size:13px;flex:1">${esc(item.title||'Untitled')}</span>
          <span style="font-size:11px;color:var(--text-3)">${item.startTime||'No time'}</span>
        </div>
      `).join('');
  }

  if (widgetId === 'notes') {
    const form = document.createElement('div');
    const notesHTML = data.pinnedNotes.length ? `<div class="section-title" style="margin:16px 0 8px">Pinned Notes</div>` +
      data.pinnedNotes.slice(0, 5).map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">${esc(n.title||'Untitled')}</div>`).join('') : '';
    form.innerHTML = `
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="qnote-title" placeholder="Note title…" style="width:100%"/>
      </div>
      ${notesHTML}
    `;
    modal.open({
      title: 'New Note',
      content: form,
      confirmLabel: 'Create Note',
      onConfirm: async (modalEl) => {
        const title = modalEl.querySelector('#qnote-title').value.trim();
        if (!title) { toast('Title required', 'error'); return; }
        const note = { id: uuid(), title, body: '', tags: [], linkedDates: [today], attachments: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
        await put('notes', note);
        modal.close();
        toast('Note created');
        emit('note-saved', note);
      },
    });
    return;
  }

  if (widgetId === 'goals') {
    const form = document.createElement('div');
    const goalsHTML = data.activeGoals.length ? `<div class="section-title" style="margin:16px 0 8px">Active Goals</div>` +
      data.activeGoals.slice(0, 5).map(g => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">${esc(g.title||'Untitled')}</div>`).join('') : '';
    form.innerHTML = `
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="qgoal-title" placeholder="Goal title…" style="width:100%"/>
      </div>
      ${goalsHTML}
    `;
    modal.open({
      title: 'New Goal',
      content: form,
      confirmLabel: 'Create Goal',
      onConfirm: async (modalEl) => {
        const title = modalEl.querySelector('#qgoal-title').value.trim();
        if (!title) { toast('Title required', 'error'); return; }
        const goal = { id: uuid(), title, description: '', category: '', targetDate: '', status: 'active', progress: 0, color: '#2dd4bf', dashPinned: false, createdAt: Date.now(), updatedAt: Date.now() };
        await put('goals', goal);
        modal.close();
        toast('Goal created');
        emit('goal-saved', goal);
      },
    });
    return;
  }

  if (widgetId === 'events') {
    const form = document.createElement('div');
    form.innerHTML = `
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="qev-title" placeholder="Event title…" style="width:100%"/>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="qev-date" value="${today}"/>
        </div>
        <div class="form-group">
          <label>Time</label>
          <input type="time" id="qev-start"/>
        </div>
      </div>
      ${itemListHTML(data.todayEvents)}
    `;
    modal.open({
      title: 'Add Event',
      content: form,
      confirmLabel: 'Create Event',
      onConfirm: async (modalEl) => {
        const title = modalEl.querySelector('#qev-title').value.trim();
        if (!title) { toast('Title required', 'error'); return; }
        const ev = { id: uuid(), type: 'event', title, date: modalEl.querySelector('#qev-date').value || today, startTime: modalEl.querySelector('#qev-start').value, endTime: '', attendees: [], color: '#2dd4bf', recurrence: 'none', dashPinned: false, createdAt: Date.now(), updatedAt: Date.now() };
        await put('events', ev);
        modal.close();
        toast('Event created');
        emit('event-saved', ev);
      },
    });
    return;
  }

  if (widgetId === 'meetings') {
    const form = document.createElement('div');
    form.innerHTML = `
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="qmt-title" placeholder="Meeting title…" style="width:100%"/>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="qmt-date" value="${today}"/>
        </div>
        <div class="form-group">
          <label>Time</label>
          <input type="time" id="qmt-start"/>
        </div>
      </div>
      ${itemListHTML(data.todayMeetings)}
    `;
    modal.open({
      title: 'Add Meeting',
      content: form,
      confirmLabel: 'Create Meeting',
      onConfirm: async (modalEl) => {
        const title = modalEl.querySelector('#qmt-title').value.trim();
        if (!title) { toast('Title required', 'error'); return; }
        const meeting = { id: uuid(), type: 'meeting', title, date: modalEl.querySelector('#qmt-date').value || today, startTime: modalEl.querySelector('#qmt-start').value, endTime: '', attendees: [], body: '', color: '#2dd4bf', recurrence: 'none', dashPinned: false, createdAt: Date.now(), updatedAt: Date.now() };
        await put('events', meeting);
        modal.close();
        toast('Meeting created');
        emit('event-saved', meeting);
      },
    });
    return;
  }
}

// ── Widget Renderers ──────────────────────────────────────────────────────────

function renderBookmarkRow(el, bookmarks) {
  if (bookmarks.length === 0) {
    const msg = document.createElement('span');
    msg.style.cssText = 'color:var(--text-3);font-size:12px';
    msg.textContent = 'No bookmarks yet — ';
    const link = document.createElement('button');
    link.className = 'btn btn-ghost';
    link.style.cssText = 'font-size:11px;padding:2px 8px';
    link.textContent = 'Add bookmarks';
    link.addEventListener('click', () => { if (!_isEditMode) navigate('bookmarks'); });
    el.appendChild(msg);
    el.appendChild(link);
    return;
  }
  bookmarks.slice(0, 16).forEach(bm => {
    const a = document.createElement('a');
    a.href = bm.url && !bm.url.match(/^[a-zA-Z][\w+\-.]*:\/\//) ? 'https://' + bm.url : bm.url;
    a.className = 'dash-bm-item';
    a.title = bm.title + '\n' + bm.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', e => { if (_isEditMode) e.preventDefault(); });
    let faviconHTML;
    if (bm.faviconDataUrl) {
      faviconHTML = `<img src="${bm.faviconDataUrl}" alt=""/>`;
    } else {
      try {
        const domain = new URL(bm.url).hostname;
        faviconHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="" onerror="this.parentElement.textContent='${esc(getInitial(bm.title))}'"/>`;
      } catch {
        faviconHTML = `<span>${getInitial(bm.title)}</span>`;
      }
    }
    a.innerHTML = `<div class="dash-bm-icon">${faviconHTML}</div><div class="dash-bm-label">${esc(bm.title)}</div>`;
    el.appendChild(a);
  });
}

function renderEventsWidget(el, events) {
  if (events.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:12px 0"><div class="empty-desc">No upcoming events</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '12px';
    btn.textContent = '+ Add event';
    btn.addEventListener('click', () => { if (!_isEditMode) navigate('calendar'); });
    el.querySelector('.empty-state').appendChild(btn);
    return;
  }
  const today = todayISO();
  events.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'dash-event-item';
    const dateLabel = ev.date !== today ? `<span class="dash-event-date">${ev.date}</span>` : '';
    item.innerHTML = `
      <div class="day-event-dot" style="background:${ev.color || 'var(--accent)'}"></div>
      <div class="day-event-content">
        <div class="day-event-title">${esc(ev.title)}</div>
        <div class="day-event-time">${dateLabel}${ev.startTime ? ev.startTime + (ev.endTime ? ' – ' + ev.endTime : '') : 'All day'}</div>
      </div>
    `;
    item.addEventListener('click', () => { if (!_isEditMode) navigate('calendar', { openDate: ev.date }); });
    el.appendChild(item);
  });
}

function renderNotesWidget(el, notes) {
  if (notes.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:12px 0"><div class="empty-desc">Pin a note to see it here</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '12px';
    btn.textContent = '+ New note';
    btn.addEventListener('click', () => { if (!_isEditMode) navigate('notes'); });
    el.querySelector('.empty-state').appendChild(btn);
    return;
  }
  notes.slice(0, 4).forEach(n => {
    const item = document.createElement('div');
    item.className = 'dash-note-item';
    item.innerHTML = `
      <div class="dash-note-title">${esc(n.title || 'Untitled')}</div>
      <div class="dash-note-preview">${esc(stripHTML(n.body || '').slice(0, 80))}</div>
    `;
    item.addEventListener('click', () => { if (!_isEditMode) navigate('notes', { openId: n.id }); });
    el.appendChild(item);
  });
}

function renderGoalsWidget(el, goals) {
  if (goals.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:12px 0"><div class="empty-desc">No active goals</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '12px';
    btn.textContent = '+ New goal';
    btn.addEventListener('click', () => { if (!_isEditMode) navigate('goals'); });
    el.querySelector('.empty-state').appendChild(btn);
    return;
  }
  goals.slice(0, 5).forEach(g => {
    const item = document.createElement('div');
    item.className = 'goal-widget-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div class="goal-widget-dot" style="background:${g.color || 'var(--accent)'}"></div>
      <div class="goal-widget-info">
        <div class="goal-widget-title">${esc(g.title)}</div>
        <div class="progress-bar" style="margin-top:4px">
          <div class="progress-bar-fill" style="width:${g.progress || 0}%"></div>
        </div>
      </div>
      <div class="goal-widget-pct">${g.progress || 0}%</div>
    `;
    item.addEventListener('click', () => { if (!_isEditMode) navigate('goals', { openId: g.id }); });
    el.appendChild(item);
  });
}

function renderMeetingsWidget(el, meetings) {
  if (meetings.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:12px 0"><div class="empty-desc">No upcoming meetings</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '12px';
    btn.textContent = '+ New meeting';
    btn.addEventListener('click', () => { if (!_isEditMode) navigate('meetings'); });
    el.querySelector('.empty-state').appendChild(btn);
    return;
  }
  const today = todayISO();
  meetings.slice(0, 5).forEach(m => {
    const item = document.createElement('div');
    item.className = 'dash-event-item';
    const dateLabel = m.date !== today ? `<span class="dash-event-date">${m.date}</span>` : '';
    item.innerHTML = `
      <div class="day-event-dot" style="background:${m.color || 'var(--accent)'}"></div>
      <div class="day-event-content">
        <div class="day-event-title">${esc(m.title)}</div>
        <div class="day-event-time">${dateLabel}${m.startTime ? m.startTime + (m.endTime ? ' – ' + m.endTime : '') : 'No time'} · ${(m.attendees || []).length} attendee${(m.attendees || []).length !== 1 ? 's' : ''}</div>
      </div>
    `;
    item.addEventListener('click', () => { if (!_isEditMode) navigate('meetings', { openId: m.id }); });
    el.appendChild(item);
  });
}

// ── Events Widget Settings Popover ────────────────────────────────────────────

function showEventsSettingsPopover(cogBtn, pref, allEventsList, body) {
  // Toggle — close if already open
  const existing = document.querySelector('.events-widget-popover');
  if (existing) { existing.remove(); return; }

  const popover = document.createElement('div');
  popover.className = 'events-widget-popover';
  popover.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;letter-spacing:0.02em">Event Filter</div>
    <label class="ewp-row ${pref.showAll ? 'ewp-disabled' : ''}">
      <input type="checkbox" id="ewp-tomorrow" ${pref.showTomorrow && !pref.showAll ? 'checked' : ''} ${pref.showAll ? 'disabled' : ''}>
      <span>Include tomorrow</span>
    </label>
    <label class="ewp-row">
      <input type="checkbox" id="ewp-all" ${pref.showAll ? 'checked' : ''}>
      <span>All upcoming (next 10)</span>
    </label>
  `;

  // Position below the cog button, right-aligned
  const rect = cogBtn.getBoundingClientRect();
  popover.style.top  = `${rect.bottom + 6}px`;
  popover.style.right = `${window.innerWidth - rect.right}px`;
  document.body.appendChild(popover);

  const tomorrowCb = popover.querySelector('#ewp-tomorrow');
  const allCb      = popover.querySelector('#ewp-all');
  const tomorrowRow = popover.querySelector('label:first-of-type');

  function syncState() {
    tomorrowCb.disabled = allCb.checked;
    tomorrowRow.classList.toggle('ewp-disabled', allCb.checked);
  }

  async function applyChange() {
    const newPref = { showTomorrow: tomorrowCb.checked, showAll: allCb.checked };
    Object.assign(pref, newPref);
    await saveEventsWidgetPref(newPref);
    body.innerHTML = '';
    renderEventsWidget(body, filterEventsForWidget(newPref, allEventsList));
  }

  tomorrowCb.addEventListener('change', () => { syncState(); applyChange(); });
  allCb.addEventListener('change',      () => { syncState(); applyChange(); });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function onOutside(e) {
      if (!popover.contains(e.target) && e.target !== cogBtn) {
        popover.remove();
        document.removeEventListener('click', onOutside);
      }
    });
  }, 10);
}

// ── Widget Customize Panel ────────────────────────────────────────────────────

function showCustomizePanel(container, widgets, data) {
  container.querySelector('#dash-customize-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'dash-customize-panel';
  panel.innerHTML = `
    <div class="customize-backdrop"></div>
    <div class="customize-panel">
      <div class="customize-panel-header">
        <span style="font-size:15px;font-weight:700">Customize Dashboard</span>
        <button class="btn-icon" id="dash-close-btn" title="Close">✕</button>
      </div>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:16px">
        Toggle widgets on/off and drag to reorder them.
      </p>
      <div id="widget-config-list"></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost" id="dash-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="dash-save-btn">Save Changes</button>
      </div>
    </div>
  `;

  injectCustomizeStyles();
  container.appendChild(panel);

  let working = widgets.map(w => ({ ...w })).sort((a, b) => (a.order || 0) - (b.order || 0));
  const listEl = panel.querySelector('#widget-config-list');

  function buildConfigList() {
    listEl.innerHTML = '';
    working.forEach(w => {
      const row = document.createElement('div');
      row.className = 'widget-config-row';
      row.dataset.id = w.id;
      row.draggable = true;
      row.innerHTML = `
        <span class="widget-drag-handle" title="Drag to reorder">⠿</span>
        <label class="toggle" style="flex-shrink:0">
          <input type="checkbox" class="widget-toggle" data-wid="${w.id}" ${w.enabled ? 'checked' : ''}/>
          <span class="toggle-slider"></span>
        </label>
        <span class="widget-config-label">${w.label}</span>
      `;
      listEl.appendChild(row);
    });

    listEl.querySelectorAll('.widget-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const w = working.find(x => x.id === cb.dataset.wid);
        if (w) w.enabled = cb.checked;
      });
    });

    makeSortable(listEl, '.widget-config-row', (ordered) => {
      const newOrder = ordered.map(el => el.dataset.id);
      working.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      working.forEach((w, i) => { w.order = i; });
    });
  }

  buildConfigList();

  const close = () => panel.remove();
  panel.querySelector('#dash-close-btn').addEventListener('click', close);
  panel.querySelector('#dash-cancel-btn').addEventListener('click', close);
  panel.querySelector('.customize-backdrop').addEventListener('click', close);

  panel.querySelector('#dash-save-btn').addEventListener('click', async () => {
    working.forEach((w, i) => { w.order = i; });
    await saveWidgetConfig(working);
    toast('Dashboard updated');
    close();
    await render(container);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHTML(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

function getInitial(title) {
  return (title || '?')[0].toUpperCase();
}

// ── Styles ────────────────────────────────────────────────────────────────────

let customizeStylesInjected = false;
function injectCustomizeStyles() {
  if (customizeStylesInjected) return;
  customizeStylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    #dash-customize-panel { position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center; }
    .customize-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.65); }
    .customize-panel { position: relative; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; width: 380px; max-height: 80vh; overflow-y: auto; animation: slideUp 0.15s ease; box-shadow: 0 24px 64px rgba(0,0,0,0.5); }
    .customize-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .widget-config-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-3); margin-bottom: 6px; transition: border-color 0.1s; }
    .widget-config-row:hover { border-color: var(--text-3); }
    .widget-config-row.dragging { opacity: 0.4; }
    .widget-config-row.drag-over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-3)); }
    .widget-drag-handle { font-size: 18px; color: var(--text-3); cursor: grab; user-select: none; line-height: 1; }
    .widget-drag-handle:active { cursor: grabbing; }
    .widget-config-label { font-size: 13px; font-weight: 500; color: var(--text); }
  `;
  document.head.appendChild(s);
}

let dashStylesInjected = false;
function injectDashboardStyles() {
  if (dashStylesInjected) return;
  dashStylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .dashboard-layout { max-width: 1100px; margin: 0 auto; }
    .dash-unified-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
    .dash-widget-full { grid-column: 1 / -1; }
    .dash-widget-block { position: relative; }
    .dashboard-clock-section { text-align: center; padding: 24px 0 20px; }
    .dashboard-time { font-size: 52px; font-weight: 800; letter-spacing: -2px; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1; }
    .dashboard-date { font-size: 15px; color: var(--text-3); margin-top: 6px; }
    .dash-clock-btns { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
    .dashboard-section { margin-bottom: 4px; }
    .widget-card-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; }
    .widget-add-btn { font-size:20px;line-height:1;color:var(--text-3);transition:color var(--transition); }
    .widget-add-btn:hover { color:var(--accent); }
    .dash-bookmark-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .dash-bm-item { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 60px; text-decoration: none; padding: 6px; border-radius: var(--radius-lg); transition: background var(--transition); }
    .dash-bm-item:hover { background: var(--bg-2); text-decoration: none; }
    .dash-bm-icon { width: 36px; height: 36px; border-radius: 7px; background: var(--bg-3); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: var(--accent); overflow: hidden; }
    .dash-bm-icon img { width: 100%; height: 100%; object-fit: cover; }
    .dash-bm-label { font-size: 10px; color: var(--text-2); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
    .dash-event-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); cursor: pointer; }
    .dash-event-item:last-child { border-bottom: none; }
    .dash-event-item:hover .day-event-title { color: var(--accent); }
    .dash-event-date { display: inline-block; font-size: 10px; color: var(--text-3); background: var(--bg-3); border-radius: 3px; padding: 1px 4px; margin-right: 4px; }
    .dash-note-item { padding: 8px; border-radius: var(--radius); cursor: pointer; margin-bottom: 4px; transition: background var(--transition); }
    .dash-note-item:hover { background: var(--bg-3); }
    .dash-note-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
    .dash-note-preview { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Edit mode */
    .dash-unified-grid.editing .dash-widget-block { cursor: grab; outline: 1px dashed var(--border); border-radius: var(--radius-lg); }
    .dash-unified-grid.editing .dash-widget-block:hover { outline-color: var(--accent); }
    .dash-unified-grid.editing .dash-widget-block.dragging { opacity: 0.4; outline: 2px solid var(--accent); }
    .dash-unified-grid.editing .dash-widget-block.drag-over { outline: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: var(--radius-lg); }
    .dash-edit-overlay { display: none; position: absolute; inset: 0; cursor: grab; z-index: 10; border-radius: var(--radius-lg); }
    .editing .dash-edit-overlay { display: block; }
    .dash-edit-overlay::after { content: '⠿ drag'; position: absolute; top: 8px; right: 8px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 3px 8px; font-size: 11px; color: var(--text-3); cursor: grab; }
    .dash-edit-bar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--bg-2); border: 1px solid var(--accent); border-radius: var(--radius-lg); padding: 12px 20px; display: flex; align-items: center; gap: 16px; z-index: 800; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: slideUp 0.15s ease; white-space: nowrap; }

    /* Events widget cog + popover */
    .widget-cog-btn { font-size: 14px; color: var(--text-3); transition: color var(--transition); }
    .widget-cog-btn:hover { color: var(--accent); }
    .events-widget-popover { position: fixed; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; width: 220px; z-index: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: slideUp 0.12s ease; }
    .ewp-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; font-size: 13px; color: var(--text-2); border-radius: 4px; transition: color var(--transition); }
    .ewp-row:hover { color: var(--text); }
    .ewp-disabled { opacity: 0.4; cursor: default; pointer-events: none; }
  `;
  document.head.appendChild(s);
}
