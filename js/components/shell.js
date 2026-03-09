import { getSettings, saveSettings } from '../db/storage.js';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',  icon: '⌂' },
  { id: 'notes',     label: 'Notes',      icon: '✎' },
  { id: 'calendar',  label: 'Calendar',   icon: '▦' },
  { id: 'meetings',  label: 'Meetings',   icon: '◑' },
  { id: 'bookmarks', label: 'Bookmarks',  icon: '☆' },
  { id: 'goals',     label: 'Goals',      icon: '◎' },
];

const BOTTOM_ITEMS = [
  { id: 'settings',  label: 'Settings',   icon: '⚙' },
];

const sidebar  = document.getElementById('sidebar');
const topbar   = document.getElementById('topbar');
const app      = document.getElementById('app');

export async function renderShell(onNavigate) {
  const settings = await getSettings();
  if (settings.sidebarCollapsed) app.classList.add('sidebar-collapsed');

  // ── Sidebar ─────────────────────────────────────────────────────────────
  const brandName = settings.brandName || 'Productivity';
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">${brandName[0].toUpperCase()}</div>
      <span class="sidebar-logo-text">${brandName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
    </div>
    <nav class="sidebar-nav" id="sidebar-nav"></nav>
    <div class="sidebar-footer">
      <button class="sidebar-collapse-btn" id="collapse-btn" title="Toggle sidebar">
        <span class="sidebar-collapse-icon">◀</span>
        <span class="collapse-label">Collapse</span>
      </button>
    </div>
  `;

  const nav = sidebar.querySelector('#sidebar-nav');

  function renderNavItem(item) {
    const el = document.createElement('a');
    el.className = 'nav-item';
    el.dataset.view = item.id;
    el.href = `#${item.id}`;
    el.innerHTML = `<span class="nav-icon">${item.icon}</span><span class="nav-label">${item.label}</span>`;
    el.addEventListener('click', e => {
      e.preventDefault();
      onNavigate(item.id);
    });
    return el;
  }

  NAV_ITEMS.forEach(item => nav.appendChild(renderNavItem(item)));

  const sep = document.createElement('hr');
  sep.className = 'divider';
  sep.style.margin = '8px 10px';
  nav.appendChild(sep);

  BOTTOM_ITEMS.forEach(item => nav.appendChild(renderNavItem(item)));

  // Collapse button
  sidebar.querySelector('#collapse-btn').addEventListener('click', async () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    await saveSettings({ sidebarCollapsed: collapsed });
  });

  // ── Topbar ───────────────────────────────────────────────────────────────
  topbar.innerHTML = `
    <span class="topbar-title" id="view-title">Dashboard</span>
    <div class="topbar-actions">
      <span id="clock"></span>
    </div>
  `;

  startClock();
}

export function setActiveNav(viewId) {
  sidebar.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  const label = [...NAV_ITEMS, ...BOTTOM_ITEMS].find(i => i.id === viewId)?.label || '';
  const titleEl = document.getElementById('view-title');
  if (titleEl) titleEl.textContent = label;
}

function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const date = now.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    clockEl.textContent = `${date}  ·  ${time}`;
  }

  tick();
  setInterval(tick, 1000);
}
