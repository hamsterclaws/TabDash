import { getByDateRange, getByIndex, put, remove } from '../db/idb.js';
import { getAll as getAllNotes } from '../db/idb.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { emit, on } from '../utils/eventbus.js';
import { toISODate, todayISO, getMonthGrid, getWeekDates, DAY_NAMES_SHORT, formatMonthYear, friendlyDate, parseISODate } from '../utils/date.js';

function uuid() { return crypto.randomUUID(); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const EVENT_COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#facc15'];

let viewMode   = 'month';
let currentYear, currentMonth;
let selectedDate = todayISO();
let eventsCache = {};

export async function render(container, state = {}) {
  const today = new Date();
  currentYear  = today.getFullYear();
  currentMonth = today.getMonth();
  if (state.openDate) {
    selectedDate = state.openDate;
    const d = new Date(state.openDate + 'T00:00:00');
    currentYear  = d.getFullYear();
    currentMonth = d.getMonth();
  }

  container.innerHTML = `
    <div class="calendar-wrapper">
      <div class="calendar-main" id="cal-main"></div>
      <div class="calendar-day-panel" id="cal-day-panel"></div>
    </div>
  `;

  await renderCal(container);
  await renderDayPanel(container, selectedDate);
}

async function renderCal(container) {
  const main = container.querySelector('#cal-main');
  if (!main) return;

  main.innerHTML = `
    <div class="cal-header">
      <div class="cal-nav">
        <button class="btn btn-ghost btn-icon" id="cal-prev">◀</button>
        <span class="cal-month-label">${viewMode === 'month'
          ? formatMonthYear(currentYear, currentMonth)
          : 'Week of ' + friendlyDate(getWeekDates(parseISODate(selectedDate))[0])
        }</span>
        <button class="btn btn-ghost btn-icon" id="cal-next">▶</button>
        <button class="btn btn-ghost" id="cal-today" style="font-size:12px">Today</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:11px;color:var(--text-3)">Double-click a day to add</span>
        <button class="btn btn-primary" id="cal-add-event" style="font-size:12px">+ Event</button>
        <div class="cal-view-toggle">
          <button class="cal-view-btn ${viewMode === 'month' ? 'active' : ''}" data-mode="month">Month</button>
          <button class="cal-view-btn ${viewMode === 'week' ? 'active' : ''}" data-mode="week">Week</button>
        </div>
      </div>
    </div>
    <div id="cal-grid-container"></div>
  `;

  // Load events for the visible range
  let lower, upper;
  if (viewMode === 'month') {
    lower = toISODate(new Date(currentYear, currentMonth, 1));
    upper = toISODate(new Date(currentYear, currentMonth + 1, 0));
  } else {
    const wdates = getWeekDates(parseISODate(selectedDate));
    lower = toISODate(wdates[0]);
    upper = toISODate(wdates[6]);
  }

  const events = await getByDateRange('events', 'date', lower, upper);
  eventsCache = {};
  events.forEach(ev => {
    if (!eventsCache[ev.date]) eventsCache[ev.date] = [];
    eventsCache[ev.date].push(ev);
  });

  const grid = main.querySelector('#cal-grid-container');
  if (viewMode === 'month') {
    renderMonthGrid(grid);
  } else {
    renderWeekGrid(grid);
  }

  // Nav
  main.querySelector('#cal-prev').addEventListener('click', () => {
    if (viewMode === 'month') {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    } else {
      const d = parseISODate(selectedDate);
      d.setDate(d.getDate() - 7);
      selectedDate = toISODate(d);
    }
    renderCal(container);
  });
  main.querySelector('#cal-next').addEventListener('click', () => {
    if (viewMode === 'month') {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    } else {
      const d = parseISODate(selectedDate);
      d.setDate(d.getDate() + 7);
      selectedDate = toISODate(d);
    }
    renderCal(container);
  });
  main.querySelector('#cal-today').addEventListener('click', () => {
    const t = new Date();
    currentYear = t.getFullYear(); currentMonth = t.getMonth();
    selectedDate = todayISO();
    renderCal(container);
    renderDayPanel(container, selectedDate);
  });
  main.querySelector('#cal-add-event').addEventListener('click', () => {
    showEventModal(container, null, selectedDate);
  });
  main.querySelectorAll('.cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      renderCal(container);
    });
  });
}

function renderMonthGrid(grid) {
  const cells = getMonthGrid(currentYear, currentMonth);
  const dayNames = DAY_NAMES_SHORT();

  grid.innerHTML = `
    <div class="cal-grid">
      ${dayNames.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
      ${cells.map(cell => {
        const dayEvents = eventsCache[cell.iso] || [];
        return `
          <div class="cal-cell ${cell.isThisMonth ? '' : 'other-month'} ${cell.isToday ? 'today' : ''} ${cell.iso === selectedDate ? 'selected' : ''}"
               data-iso="${cell.iso}">
            <div class="cal-date-num">${cell.date.getDate()}</div>
            <div class="cal-dots">
              ${dayEvents.slice(0, 4).map(ev => `<div class="cal-dot" style="background:${ev.color || 'var(--accent)'}"></div>`).join('')}
            </div>
            ${dayEvents.slice(0, 2).map(ev => `<div class="cal-event-label" style="border-color:${ev.color || 'var(--accent)'}">${esc(ev.title)}</div>`).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;

  grid.querySelectorAll('.cal-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      selectedDate = cell.dataset.iso;
      grid.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('selected', c.dataset.iso === selectedDate));
      renderDayPanel(document.querySelector('#view'), selectedDate);
    });
    cell.addEventListener('dblclick', () => {
      showEventModal(container, null, cell.dataset.iso);
    });
  });
}

function renderWeekGrid(grid) {
  const wdates = getWeekDates(parseISODate(selectedDate));
  const dayNames = DAY_NAMES_SHORT();
  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm

  grid.innerHTML = `
    <div class="week-grid">
      <div class="week-header-cell"></div>
      ${wdates.map((d, i) => `
        <div class="week-header-cell ${toISODate(d) === todayISO() ? 'today' : ''}">
          <div class="week-day-name">${dayNames[i]}</div>
          <div class="week-day-num ${toISODate(d) === todayISO() ? 'today' : ''}">${d.getDate()}</div>
        </div>
      `).join('')}
      ${hours.map(h => `
        <div class="week-hour-label">${h === 12 ? '12pm' : h > 12 ? (h-12)+'pm' : h+'am'}</div>
        ${wdates.map(d => {
          const iso = toISODate(d);
          const slotEvents = (eventsCache[iso] || []).filter(ev => {
            if (!ev.startTime) return false;
            const evH = parseInt(ev.startTime.split(':')[0]);
            return evH === h;
          });
          return `
            <div class="week-day-col" data-iso="${iso}" data-hour="${h}">
              ${slotEvents.map(ev => `
                <div class="week-event" style="background:${ev.color || 'var(--accent)'}">
                  ${esc(ev.title)}
                </div>
              `).join('')}
            </div>
          `;
        }).join('')}
      `).join('')}
    </div>
  `;

  grid.querySelectorAll('.week-day-col').forEach(cell => {
    cell.addEventListener('click', () => {
      selectedDate = cell.dataset.iso;
      renderDayPanel(document.querySelector('#view'), selectedDate);
    });
    cell.addEventListener('dblclick', e => {
      e.stopPropagation();
      showEventModal(container, null, cell.dataset.iso);
    });
  });
}

async function renderDayPanel(container, iso) {
  const panel = container?.querySelector?.('#cal-day-panel') || document.querySelector('#cal-day-panel');
  if (!panel) return;

  const events = eventsCache[iso] || await getByDateRange('events', 'date', iso, iso);
  const notes  = await getByIndex('notes', 'linkedDates', iso);

  const d = parseISODate(iso);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  panel.innerHTML = `
    <div class="day-panel-header">
      <div class="day-panel-date">${label}</div>
      <button class="btn btn-primary" id="day-add-event" style="font-size:12px">+ Event</button>
    </div>
    <div class="section-title">Events (${events.length})</div>
    <div id="day-events-list">
      ${events.length === 0 ? `<div style="color:var(--text-3);font-size:12px;padding:8px 0">No events</div>` :
        events.map(ev => `
          <div class="day-event-item" data-id="${ev.id}">
            <div class="day-event-dot" style="background:${ev.color || 'var(--accent)'}"></div>
            <div class="day-event-content">
              <div class="day-event-title">${esc(ev.title)}</div>
              <div class="day-event-time">${ev.startTime ? ev.startTime + (ev.endTime ? '–' + ev.endTime : '') : 'All day'} · ${ev.type}</div>
            </div>
            <button class="btn-icon" data-delete="${ev.id}" title="Delete" style="font-size:13px">✕</button>
          </div>
        `).join('')}
    </div>
    <hr class="divider" />
    <div class="section-title">Linked Notes (${notes.length})</div>
    <div id="day-notes-list">
      ${notes.length === 0 ? `<div style="color:var(--text-3);font-size:12px;padding:8px 0">No notes linked</div>` :
        notes.map(n => `
          <div class="day-linked-note" data-noteid="${n.id}">
            <div class="day-linked-note-title">${esc(n.title || 'Untitled')}</div>
            <div class="day-linked-note-preview">${esc(stripTagsPreview(n.body || ''))}</div>
          </div>
        `).join('')}
    </div>
  `;

  panel.querySelector('#day-add-event').addEventListener('click', () => {
    showEventModal(container, null, iso);
  });

  panel.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await remove('events', btn.dataset.delete);
      delete eventsCache[iso];
      toast('Event deleted', 'info');
      emit('event-saved', null);
      await renderCal(container);
      await renderDayPanel(container, iso);
    });
  });

  panel.querySelectorAll('.day-event-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.dataset.delete) return;
      const ev = events.find(ev => ev.id === el.dataset.id);
      if (ev) showEventModal(container, ev, iso);
    });
  });
}

function showEventModal(container, existingEvent, date) {
  const ev = existingEvent || {
    id: uuid(), type: 'event', date, title: '',
    startTime: '', endTime: '', attendees: [], noteId: null,
    attachments: [], color: EVENT_COLORS[0], recurrence: 'none',
    dashPinned: false, createdAt: Date.now(),
  };
  const isNew = !existingEvent;

  const colorSwatches = EVENT_COLORS.map(c =>
    `<span class="color-swatch ${ev.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`
  ).join('');

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="ev-title" value="${esc(ev.title)}" placeholder="Event title…" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select id="ev-type">
          <option value="event" ${ev.type === 'event' ? 'selected' : ''}>Event</option>
          <option value="meeting" ${ev.type === 'meeting' ? 'selected' : ''}>Meeting</option>
        </select>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="ev-date" value="${ev.date}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Start time</label>
        <input type="time" id="ev-start" value="${ev.startTime || ''}" />
      </div>
      <div class="form-group">
        <label>End time</label>
        <input type="time" id="ev-end" value="${ev.endTime || ''}" />
      </div>
    </div>
    <div class="form-group">
      <label>Color</label>
      <div class="color-picker-row">${colorSwatches}</div>
    </div>
    <div class="form-group">
      <label>Recurrence</label>
      <select id="ev-recurrence">
        <option value="none" ${ev.recurrence === 'none' ? 'selected' : ''}>None</option>
        <option value="daily" ${ev.recurrence === 'daily' ? 'selected' : ''}>Daily</option>
        <option value="weekly" ${ev.recurrence === 'weekly' ? 'selected' : ''}>Weekly</option>
        <option value="monthly" ${ev.recurrence === 'monthly' ? 'selected' : ''}>Monthly</option>
      </select>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:normal">
        <input type="checkbox" id="ev-dash-pin" ${ev.dashPinned ? 'checked' : ''}/>
        Pin to Dashboard (show regardless of date)
      </label>
    </div>
  `;

  let selectedColor = ev.color;

  modal.open({
    title: isNew ? 'New Event' : 'Edit Event',
    content: form,
    confirmLabel: isNew ? 'Create Event' : 'Save',
    onConfirm: async (modalEl) => {
      const title = modalEl.querySelector('#ev-title').value.trim();
      if (!title) { toast('Title is required', 'error'); return; }
      ev.title      = title;
      ev.type       = modalEl.querySelector('#ev-type').value;
      ev.date       = modalEl.querySelector('#ev-date').value || date;
      ev.startTime  = modalEl.querySelector('#ev-start').value;
      ev.endTime    = modalEl.querySelector('#ev-end').value;
      ev.color      = selectedColor;
      ev.recurrence = modalEl.querySelector('#ev-recurrence').value;
      ev.dashPinned = modalEl.querySelector('#ev-dash-pin').checked;
      ev.updatedAt  = Date.now();
      await put('events', ev);
      eventsCache = {};
      modal.close();
      toast(isNew ? 'Event created' : 'Event updated');
      emit('event-saved', ev);
      await renderCal(container);
      await renderDayPanel(container, ev.date);
    },
  });

  // Color swatch handlers
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });
}

function stripTagsPreview(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').slice(0, 80);
}
