import { openDB } from './db/idb.js';
import { getSettings } from './db/storage.js';
import { renderShell } from './components/shell.js';
import { register, navigate, setDefault, start } from './router.js';

import { render as renderDashboard } from './views/dashboard.js';
import { render as renderNotes }     from './views/notes.js';
import { render as renderCalendar }  from './views/calendar.js';
import { render as renderMeetings }  from './views/meetings.js';
import { render as renderBookmarks } from './views/bookmarks.js';
import { render as renderGoals }     from './views/goals.js';
import { render as renderSettings }  from './views/settings.js';

async function init() {
  // Initialize IndexedDB (creates stores if first run)
  await openDB();

  // Load user settings
  const settings = await getSettings();

  // Apply saved accent color as CSS variable
  if (settings.accentColor) {
    document.documentElement.style.setProperty('--accent', settings.accentColor);
  }

  // Render the shell (sidebar + topbar + clock)
  await renderShell((viewId) => navigate(viewId));

  // Register all views
  register('dashboard', renderDashboard);
  register('notes',     renderNotes);
  register('calendar',  renderCalendar);
  register('meetings',  renderMeetings);
  register('bookmarks', renderBookmarks);
  register('goals',     renderGoals);
  register('settings',  renderSettings);

  // Set default view from settings
  setDefault(settings.defaultView || 'dashboard');

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Ctrl+N — new note
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      navigate('notes');
    }
    // Ctrl+K — quick navigate (cycles through main views)
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      showViewPicker();
    }
  });

  // Start router (reads hash or falls back to default view)
  start();
}

function showViewPicker() {
  const views = [
    { id: 'dashboard', label: 'Dashboard',  icon: '⌂' },
    { id: 'notes',     label: 'Notes',      icon: '✎' },
    { id: 'calendar',  label: 'Calendar',   icon: '▦' },
    { id: 'meetings',  label: 'Meetings',   icon: '◑' },
    { id: 'bookmarks', label: 'Bookmarks',  icon: '☆' },
    { id: 'goals',     label: 'Goals',      icon: '◎' },
    { id: 'settings',  label: 'Settings',   icon: '⚙' },
  ];

  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '';

  const picker = document.createElement('div');
  picker.style.cssText = `
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 8px;
    width: 320px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  `;
  picker.innerHTML = `
    <input type="text" placeholder="Go to view…" id="picker-input"
      style="width:100%;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius);
             padding:10px 14px;color:var(--text);font-size:14px;outline:none;margin-bottom:8px;"/>
    <div id="picker-list">
      ${views.map(v => `
        <div class="picker-item" data-id="${v.id}"
          style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--radius);cursor:pointer;color:var(--text-2);transition:background 0.1s">
          <span style="width:20px;text-align:center;font-size:16px">${v.icon}</span>
          <span style="font-size:13px;font-weight:500">${v.label}</span>
        </div>
      `).join('')}
    </div>
  `;

  overlay.appendChild(picker);
  overlay.classList.remove('hidden');

  const input = picker.querySelector('#picker-input');
  input.focus();

  picker.querySelectorAll('.picker-item').forEach(item => {
    item.addEventListener('mouseover', () => item.style.background = 'var(--bg-hover)');
    item.addEventListener('mouseout',  () => item.style.background = '');
    item.addEventListener('click', () => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      navigate(item.dataset.id);
    });
  });

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    picker.querySelectorAll('.picker-item').forEach(item => {
      const match = item.textContent.toLowerCase().includes(q);
      item.style.display = match ? '' : 'none';
    });
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
    if (e.key === 'Enter') {
      const visible = [...picker.querySelectorAll('.picker-item')].find(el => el.style.display !== 'none');
      if (visible) { visible.click(); }
    }
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
  });
}

init().catch(console.error);
