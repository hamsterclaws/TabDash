import { getAll, put, remove, getById } from '../db/idb.js';
import { createRichText } from '../components/richtext.js';
import { createFileAttach } from '../components/fileattach.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { emit } from '../utils/eventbus.js';
import { debounce } from '../utils/debounce.js';
import { friendlyDate, todayISO, parseISODate } from '../utils/date.js';

function uuid() { return crypto.randomUUID(); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const EVENT_COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#facc15'];

let allMeetings = [];
let activeId = null;

export async function render(container, state = {}) {
  if (state.openId) activeId = state.openId;
  const events = await getAll('events');
  allMeetings = events.filter(e => e.type === 'meeting')
    .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));

  container.innerHTML = `
    <div class="two-panel">
      <div class="panel-left">
        <div class="meeting-list-header">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Meetings</span>
            <button class="btn btn-primary" id="new-meeting-btn" style="font-size:12px;padding:4px 10px">+ New</button>
          </div>
          <input class="search-input" id="meeting-search" type="search" placeholder="Search meetings…" />
        </div>
        <div class="panel-list" id="meetings-list"></div>
      </div>
      <div class="panel-right" id="meeting-editor-pane">
        <div class="empty-state">
          <div class="empty-icon">◑</div>
          <div class="empty-title">Select a meeting</div>
          <div class="empty-desc">Choose a meeting from the list or create a new one.</div>
        </div>
      </div>
    </div>
  `;

  renderMeetingList(container, '');

  container.querySelector('#new-meeting-btn').addEventListener('click', () => createMeeting(container));

  let filterText = '';
  container.querySelector('#meeting-search').addEventListener('input', e => {
    filterText = e.target.value.toLowerCase();
    renderMeetingList(container, filterText);
  });

  if (activeId) openMeeting(container, activeId);
}

function groupByDate(meetings) {
  const groups = {};
  meetings.forEach(m => {
    const key = m.date || 'No date';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  return groups;
}

function renderMeetingList(container, filter) {
  const list = container.querySelector('#meetings-list');
  if (!list) return;
  const filtered = allMeetings.filter(m =>
    !filter || m.title?.toLowerCase().includes(filter) || m.date?.includes(filter)
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-desc">${filter ? 'No results' : 'No meetings yet'}</div></div>`;
    return;
  }

  const groups = groupByDate(filtered);
  let html = '';
  const today = todayISO();

  Object.keys(groups).sort().forEach(date => {
    const label = date === today ? 'Today' : date < today ? 'Past' : friendlyDate(date);
    html += `<div class="meeting-date-group">${label}</div>`;
    groups[date].forEach(m => {
      html += `
        <div class="meeting-item ${m.id === activeId ? 'active' : ''}" data-id="${m.id}">
          <div class="meeting-color-dot" style="background:${m.color || 'var(--accent)'}"></div>
          <div class="meeting-item-info">
            <div class="meeting-item-title">${esc(m.title || 'Untitled Meeting')}</div>
            <div class="meeting-item-time">${m.startTime ? m.startTime + (m.endTime ? '–' + m.endTime : '') : 'No time'} · ${m.attendees?.length || 0} attendee${m.attendees?.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      `;
    });
  });

  list.innerHTML = html;
  list.querySelectorAll('.meeting-item').forEach(el => {
    el.addEventListener('click', () => openMeeting(container, el.dataset.id));
  });
}

async function createMeeting(container) {
  const meeting = {
    id:         uuid(),
    type:       'meeting',
    title:      '',
    date:       todayISO(),
    startTime:  '',
    endTime:    '',
    attendees:  [],
    noteId:     null,
    attachments:[],
    color:      EVENT_COLORS[0],
    recurrence: 'none',
    body:       '',
    dashPinned: false,
    createdAt:  Date.now(),
    updatedAt:  Date.now(),
  };
  await put('events', meeting);
  allMeetings.unshift(meeting);
  allMeetings.sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
  activeId = meeting.id;
  renderMeetingList(container, '');
  openMeeting(container, meeting.id);
}

async function openMeeting(container, id) {
  activeId = id;
  renderMeetingList(container, '');

  const meeting = allMeetings.find(m => m.id === id) || await getById('events', id);
  if (!meeting) return;

  const pane = container.querySelector('#meeting-editor-pane');
  pane.innerHTML = '';

  // Title
  const titleInput = document.createElement('input');
  titleInput.className = 'meeting-editor-title';
  titleInput.placeholder = 'Meeting title…';
  titleInput.value = meeting.title || '';
  pane.appendChild(titleInput);

  // Actions
  const actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;';
  actRow.innerHTML = `
    <button class="btn btn-ghost" id="meet-dash-pin-btn" style="font-size:12px">${meeting.dashPinned ? '★ On Dashboard' : '☆ Pin to Dashboard'}</button>
    <button class="btn btn-danger" id="del-meeting-btn" style="font-size:12px">Delete</button>
    <span id="meet-save-ind" style="font-size:11px;color:var(--text-3);margin-left:auto"></span>
  `;
  pane.appendChild(actRow);

  // Form fields
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row" style="margin-bottom:16px">
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="meet-date" value="${meeting.date || ''}"/>
      </div>
      <div class="form-group">
        <label>Color</label>
        <div class="color-picker-row" id="meet-colors">
          ${EVENT_COLORS.map(c => `<span class="color-swatch ${meeting.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
        </div>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:16px">
      <div class="form-group">
        <label>Start time</label>
        <input type="time" id="meet-start" value="${meeting.startTime || ''}"/>
      </div>
      <div class="form-group">
        <label>End time</label>
        <input type="time" id="meet-end" value="${meeting.endTime || ''}"/>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label>Attendees</label>
      <div class="attendees-container" id="attendees-container"></div>
    </div>
  `;
  pane.appendChild(form);

  // Attendees tag input
  const attendeesContainer = form.querySelector('#attendees-container');
  let attendees = [...(meeting.attendees || [])];
  renderAttendees(attendeesContainer, attendees, () => { meeting.attendees = attendees; save(); });

  // Color picker
  let selectedColor = meeting.color || EVENT_COLORS[0];
  form.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      form.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
      meeting.color = selectedColor;
      save();
    });
  });

  // Notes heading
  const notesHeading = document.createElement('div');
  notesHeading.className = 'section-title';
  notesHeading.textContent = 'Notes';
  notesHeading.style.marginBottom = '8px';
  pane.appendChild(notesHeading);

  const rtContainer = document.createElement('div');
  rtContainer.style.cssText = 'margin-bottom:16px;';
  pane.appendChild(rtContainer);

  const richtext = createRichText(rtContainer, {
    placeholder: 'Meeting notes…',
    onChange: () => save(),
  });
  richtext.setHTML(meeting.body || '');

  // Attachments
  const attachHeading = document.createElement('div');
  attachHeading.className = 'section-title';
  attachHeading.textContent = 'Attachments';
  attachHeading.style.marginBottom = '8px';
  pane.appendChild(attachHeading);
  createFileAttach(pane, { parentType: 'event', parentId: meeting.id }).refresh();

  const saveInd = actRow.querySelector('#meet-save-ind');
  const debouncedSave = debounce(save, 600);

  titleInput.addEventListener('input', () => { meeting.title = titleInput.value; debouncedSave(); });
  form.querySelector('#meet-date').addEventListener('change', e => { meeting.date = e.target.value; save(); });
  form.querySelector('#meet-start').addEventListener('change', e => { meeting.startTime = e.target.value; save(); });
  form.querySelector('#meet-end').addEventListener('change', e => { meeting.endTime = e.target.value; save(); });

  actRow.querySelector('#meet-dash-pin-btn').addEventListener('click', async () => {
    meeting.dashPinned = !meeting.dashPinned;
    actRow.querySelector('#meet-dash-pin-btn').textContent = meeting.dashPinned ? '★ On Dashboard' : '☆ Pin to Dashboard';
    await save();
  });

  actRow.querySelector('#del-meeting-btn').addEventListener('click', () => {
    modal.confirm({
      title: 'Delete meeting',
      message: `Delete "<strong>${esc(meeting.title || 'Untitled')}</strong>"?`,
      onConfirm: async () => {
        await remove('events', meeting.id);
        allMeetings = allMeetings.filter(m => m.id !== meeting.id);
        activeId = null;
        renderMeetingList(container, '');
        pane.innerHTML = `<div class="empty-state"><div class="empty-icon">◑</div><div class="empty-title">Meeting deleted</div></div>`;
        toast('Meeting deleted', 'info');
        emit('event-saved', null);
      },
    });
  });

  async function save() {
    meeting.title     = titleInput.value;
    meeting.body      = richtext?.getHTML() || '';
    meeting.updatedAt = Date.now();
    await put('events', meeting);
    const idx = allMeetings.findIndex(m => m.id === meeting.id);
    if (idx > -1) allMeetings[idx] = meeting; else allMeetings.unshift(meeting);
    if (saveInd) { saveInd.textContent = 'Saved'; setTimeout(() => { if (saveInd) saveInd.textContent = ''; }, 1500); }
    emit('event-saved', meeting);
    renderMeetingList(container, '');
  }
}

function renderAttendees(container, attendees, onChange) {
  container.querySelectorAll('.attendee-tag').forEach(el => el.remove());

  attendees.forEach((att, i) => {
    const tag = document.createElement('span');
    tag.className = 'attendee-tag';
    tag.innerHTML = `${esc(att)} <button data-i="${i}">×</button>`;
    tag.querySelector('button').addEventListener('click', () => {
      attendees.splice(i, 1);
      renderAttendees(container, attendees, onChange);
      onChange();
    });
    container.insertBefore(tag, container.querySelector('.attendee-input') || null);
  });

  let inp = container.querySelector('.attendee-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.className = 'attendee-input';
    inp.placeholder = 'Add name or email…';
    inp.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && inp.value.trim()) {
        e.preventDefault();
        const val = inp.value.trim().replace(/,$/, '');
        if (!attendees.includes(val)) { attendees.push(val); renderAttendees(container, attendees, onChange); onChange(); }
        inp.value = '';
      }
      if (e.key === 'Backspace' && !inp.value && attendees.length) {
        attendees.pop();
        renderAttendees(container, attendees, onChange);
        onChange();
      }
    });
    inp.addEventListener('blur', () => {
      if (inp.value.trim()) {
        const val = inp.value.trim();
        if (!attendees.includes(val)) { attendees.push(val); renderAttendees(container, attendees, onChange); onChange(); }
        inp.value = '';
      }
    });
    container.appendChild(inp);
  }
}
