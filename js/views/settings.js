import { getSettings, saveSettings } from '../db/storage.js';
import { applyGoogleFont } from '../app.js';
import { getAll, put, clearStore, putBulk, openDB } from '../db/idb.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { parseICS } from '../utils/ics.js';

const ACCENT_COLORS = [
  { label: 'Teal',   value: '#2dd4bf' },
  { label: 'Blue',   value: '#60a5fa' },
  { label: 'Pink',   value: '#f472b6' },
  { label: 'Purple', value: '#a78bfa' },
  { label: 'Orange', value: '#fb923c' },
  { label: 'Green',  value: '#34d399' },
  { label: 'Yellow', value: '#facc15' },
];

const SHORTCUTS = [
  { keys: ['Ctrl', 'N'],    desc: 'New note' },
  { keys: ['Ctrl', 'K'],    desc: 'Search / jump to view' },
  { keys: ['Esc'],          desc: 'Close modal' },
  { keys: ['Enter'],        desc: 'New block / save task' },
  { keys: ['Tab'],          desc: 'Indent block' },
  { keys: ['Shift', 'Tab'], desc: 'Unindent block' },
];

const IDB_STORES = ['notes', 'events', 'attachments', 'goals', 'tasks'];

// ── Export ────────────────────────────────────────────────────────────────────

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob || !(blob instanceof Blob)) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const res = await fetch(dataUrl);
  return res.blob();
}

async function exportAllData() {
  try {
    toast('Preparing export…');

    // Read all IndexedDB stores
    const [notes, events, attachments, goals, tasks] = await Promise.all(
      IDB_STORES.map(s => getAll(s))
    );

    // Serialize attachment Blobs as base64 data URLs so they survive JSON
    const attachmentsSerialized = await Promise.all(
      attachments.map(async a => {
        const dataUrl = await blobToDataUrl(a.blob);
        const { blob: _dropped, ...rest } = a;
        return { ...rest, _blobDataUrl: dataUrl };
      })
    );

    // Read chrome.storage.local (bookmarks, widget config, etc.)
    const local = await new Promise(res => chrome.storage.local.get(null, res));
    // Read chrome.storage.sync (user settings)
    const sync  = await new Promise(res => chrome.storage.sync.get(null, res));

    const exportData = {
      _version:    '1.0',
      _exportedAt: new Date().toISOString(),
      _app:        'Productivity Dashboard',
      db: { notes, events, attachments: attachmentsSerialized, goals, tasks },
      storageLocal: local,
      storageSync:  sync,
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `productivity-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast('Backup exported successfully');
  } catch (err) {
    console.error('Export failed:', err);
    toast('Export failed — see console for details', 'error');
  }
}

async function importAllData(file) {
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    toast('Invalid backup file', 'error');
    return;
  }

  if (!data._version || !data.db) {
    toast('Unrecognised backup format', 'error');
    return;
  }

  modal.confirm({
    title: 'Import backup',
    message: `This will <strong>replace all current data</strong> with the backup from <strong>${data._exportedAt?.slice(0, 10) || 'unknown date'}</strong>. This cannot be undone.`,
    confirmLabel: 'Replace & Import',
    confirmClass: 'btn-danger',
    onConfirm: async () => {
      try {
        toast('Importing…');
        await openDB();

        // Clear then re-populate each IndexedDB store
        for (const store of IDB_STORES) {
          await clearStore(store);
          const records = data.db[store] || [];

          if (store === 'attachments') {
            // Restore Blobs from base64 data URLs
            const restored = await Promise.all(
              records.map(async r => {
                const blob = r._blobDataUrl ? await dataUrlToBlob(r._blobDataUrl) : null;
                const { _blobDataUrl: _dropped, ...rest } = r;
                return { ...rest, blob };
              })
            );
            if (restored.length) await putBulk(store, restored);
          } else {
            if (records.length) await putBulk(store, records);
          }
        }

        // Restore chrome.storage.local (bookmarks, widget config)
        if (data.storageLocal) {
          await new Promise(res => chrome.storage.local.set(data.storageLocal, res));
        }

        // Restore chrome.storage.sync (settings)
        if (data.storageSync) {
          await new Promise(res => chrome.storage.sync.set(data.storageSync, res));
        }

        toast('Import complete — reloading…');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        console.error('Import failed:', err);
        toast('Import failed — see console for details', 'error');
      }
    },
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

export async function render(container) {
  const settings = await getSettings();

  container.innerHTML = `
    <div class="settings-wrapper">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:24px">Settings</h2>

      <!-- Appearance -->
      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">App Name</div>
            <div class="settings-desc">Shown in the top-left of the sidebar.</div>
          </div>
          <div class="settings-control">
            <input type="text" id="brand-name-input" value="${settings.brandName || 'Productivity'}"
              placeholder="Productivity" style="width:140px"/>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Accent Color</div>
            <div class="settings-desc">Highlight color used across the dashboard.</div>
            <div class="settings-desc">Change the colour of the background.</div>

          </div>
          <div class="settings-control" style="display:flex;flex-direction:column;align-items:flex-end;gap:10px">
            <input type="color" id="accent-color-wheel" value="${settings.accentColor || '#2dd4bf'}"
              title="Pick any color"
              style="width:128px;height:36px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg-3)"/>
            <div class="accent-swatches" id="accent-swatches">
              ${ACCENT_COLORS.map(c => `
                <div class="accent-swatch ${settings.accentColor === c.value ? 'selected' : ''}"
                  data-color="${c.value}" style="background:${c.value}" title="${c.label}"></div>
              `).join('')}
            </div>
            <input type="color" id="background-color-wheel" value="${settings.bgColor || '#2dd4bf'}"
              title="Pick any color"
              style="width:128px;height:36px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg-3)"/>
            <input type="color" id="background2-color-wheel" value="${settings.bg2Color || '#2dd4bf'}"
              title="Pick any color"
              style="width:128px;height:36px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg-3)"/>
            
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Sidebar</div>
            <div class="settings-desc">Start with the sidebar collapsed.</div>
          </div>
          <label class="toggle settings-control">
            <input type="checkbox" id="sidebar-toggle" ${settings.sidebarCollapsed ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- Typography -->
      <div class="settings-section">
        <div class="settings-section-title">Typography</div>

        <div class="settings-row" style="align-items:flex-start;padding-bottom:16px">
          <div style="flex:1;margin-right:16px">
            <div class="settings-label">Google Font</div>
            <div class="settings-desc" style="margin-bottom:10px">
              Paste the <code style="color:var(--accent);font-size:11px">@import</code> line from
              <a href="#" style="color:var(--accent)" onclick="return false">fonts.google.com</a>.
              Then enter the font family name exactly as shown on Google Fonts.
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <textarea id="gf-import-input" rows="3"
                placeholder="@import url('https://fonts.googleapis.com/css2?family=Inter…&display=swap');"
                style="width:100%;resize:vertical;font-size:12px;font-family:var(--font-mono)">${settings.googleFontsImport || ''}</textarea>
              <input type="text" id="gf-family-input"
                placeholder="Font family name, e.g. Inter"
                value="${settings.googleFontsFamily || ''}"
                style="width:100%"/>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary" id="gf-apply-btn">Apply Font</button>
                <button class="btn btn-ghost" id="gf-clear-btn">Reset to System Font</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Font Size</div>
            <div class="settings-desc">Scale all text up or down.</div>
          </div>
          <div class="settings-control" style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-ghost" id="font-size-dec" style="width:28px;height:28px;padding:0;font-size:16px;display:flex;align-items:center;justify-content:center">−</button>
            <span id="font-size-label"
              style="font-size:13px;color:var(--text-2);min-width:36px;text-align:center;line-height:28px">
              ${settings.fontSize || 14}px
            </span>
            <button class="btn btn-ghost" id="font-size-inc" style="width:28px;height:28px;padding:0;font-size:16px;display:flex;align-items:center;justify-content:center">+</button>
          </div>
        </div>
      </div>

      <!-- Clock & Date -->
      <div class="settings-section">
        <div class="settings-section-title">Clock & Date</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Clock Format</div>
            <div class="settings-desc">12-hour or 24-hour display.</div>
          </div>
          <div class="settings-control">
            <select id="clock-format-select">
              <option value="12h" ${settings.clockFormat === '12h' ? 'selected' : ''}>12-hour (2:30 PM)</option>
              <option value="24h" ${settings.clockFormat === '24h' ? 'selected' : ''}>24-hour (14:30)</option>
            </select>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Week Starts On</div>
            <div class="settings-desc">First day of the week in the calendar.</div>
          </div>
          <div class="settings-control">
            <select id="week-start-select">
              <option value="0" ${settings.weekStartsOn === 0 ? 'selected' : ''}>Sunday</option>
              <option value="1" ${settings.weekStartsOn === 1 ? 'selected' : ''}>Monday</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Default view -->
      <div class="settings-section">
        <div class="settings-section-title">Navigation</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Default View</div>
            <div class="settings-desc">Which section opens when you open a new tab.</div>
          </div>
          <div class="settings-control">
            <select id="default-view-select">
              <option value="dashboard" ${settings.defaultView === 'dashboard' ? 'selected' : ''}>Dashboard</option>
              <option value="notes"     ${settings.defaultView === 'notes'     ? 'selected' : ''}>Notes</option>
              <option value="calendar"  ${settings.defaultView === 'calendar'  ? 'selected' : ''}>Calendar</option>
              <option value="meetings"  ${settings.defaultView === 'meetings'  ? 'selected' : ''}>Meetings</option>
              <option value="bookmarks" ${settings.defaultView === 'bookmarks' ? 'selected' : ''}>Bookmarks</option>
              <option value="goals"     ${settings.defaultView === 'goals'     ? 'selected' : ''}>Goals</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Data & Backup -->
      <div class="settings-section">
        <div class="settings-section-title">Data & Backup</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Export Backup</div>
            <div class="settings-desc">Download all your data as a JSON file. Includes notes, goals, bookmarks, events, and settings.</div>
          </div>
          <div class="settings-control">
            <button class="btn btn-ghost" id="export-btn">Export…</button>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Import Backup</div>
            <div class="settings-desc">Restore from a previously exported JSON file. <strong style="color:var(--danger)">Replaces all current data.</strong></div>
          </div>
          <div class="settings-control">
            <label class="btn btn-ghost" style="cursor:pointer">
              Import…
              <input type="file" id="import-input" accept=".json,application/json" style="display:none"/>
            </label>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Import Calendar (.ics)</div>
            <div class="settings-desc">Import events from Google Calendar, Apple Calendar, Outlook, or any .ics file. Existing events with matching IDs are updated, not duplicated.</div>
          </div>
          <div class="settings-control">
            <label class="btn btn-ghost" style="cursor:pointer">
              Import .ics…
              <input type="file" id="import-ics-input" accept=".ics,text/calendar" style="display:none"/>
            </label>
          </div>
        </div>

        <div style="margin-top:12px;padding:10px 14px;background:var(--bg-2);border-radius:var(--radius);border:1px solid var(--border);font-size:12px;color:var(--text-3);line-height:1.6">
          <strong style="color:var(--text-2)">How to share this extension:</strong><br>
          1. Zip the entire <code style="color:var(--accent)">ChromeExtension/</code> folder.<br>
          2. On the target Chrome: go to <code style="color:var(--accent)">chrome://extensions</code>, enable <em>Developer mode</em>, click <em>Load unpacked</em>, select the unzipped folder.<br>
          3. Each Chrome profile starts with a clean slate. Use Export / Import above to transfer your data if needed.
        </div>
      </div>

      <!-- Keyboard shortcuts -->
      <div class="settings-section">
        <div class="settings-section-title">Keyboard Shortcuts</div>
        <div class="shortcut-list">
          ${SHORTCUTS.map(s => `
            <div class="shortcut-row">
              <span>${s.desc}</span>
              <span class="shortcut-key">
                ${s.keys.map(k => `<span class="kbd">${k}</span>`).join('<span style="font-size:11px;margin:0 2px;color:var(--text-3)">+</span>')}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- About -->
      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <div style="font-size:13px;color:var(--text-2);line-height:1.7">
          <div><strong>Productivity Dashboard</strong> v1.0.0</div>
          <div style="margin-top:4px;color:var(--text-3)">All data is stored locally in your browser. Nothing is sent to any server.</div>
        </div>
      </div>
    </div>
  `;

  // ── Accent color ────────────────────────────────────────────────────────────
  const colorWheel = container.querySelector('#accent-color-wheel');
  const bgColorWheel = container.querySelector('#background-color-wheel');
  const bg2ColorWheel = container.querySelector('#background2-color-wheel');
  colorWheel.addEventListener('input', e => {
    document.documentElement.style.setProperty('--accent', e.target.value);
    container.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
  });
  colorWheel.addEventListener('change', async e => {
    await saveSettings({ accentColor: e.target.value });
    toast('Accent color updated');
  });
//main background color
  bgColorWheel.addEventListener('input', e => {
    document.documentElement.style.setProperty('--bg', e.target.value);
    container.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
  });
  bgColorWheel.addEventListener('change', async e => {
    await saveSettings({ bgColor: e.target.value });
    toast('Accent color updated');
  });
//background 2 color wheel
    bg2ColorWheel.addEventListener('input', e => {
    document.documentElement.style.setProperty('--bg-2', e.target.value);
    container.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
  });
  bg2ColorWheel.addEventListener('change', async e => {
    await saveSettings({ bg2Color: e.target.value });
    toast('Background color updated');
  });

  container.querySelectorAll('.accent-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      container.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      const color = sw.dataset.color;
      document.documentElement.style.setProperty('--accent', color);
      colorWheel.value = color;
      await saveSettings({ accentColor: color });
      toast('Accent color updated');
    });
  });

  // ── Brand name ──────────────────────────────────────────────────────────────
  container.querySelector('#brand-name-input').addEventListener('change', async e => {
    const name = e.target.value.trim() || 'Productivity';
    e.target.value = name;
    await saveSettings({ brandName: name });
    const logoText = document.querySelector('.sidebar-logo-text');
    const logoIcon = document.querySelector('.sidebar-logo-icon');
    if (logoText) logoText.textContent = name;
    if (logoIcon) logoIcon.textContent = name[0].toUpperCase();
    toast('App name updated');
  });

  // ── Sidebar collapsed ───────────────────────────────────────────────────────
  container.querySelector('#sidebar-toggle').addEventListener('change', async e => {
    document.getElementById('app').classList.toggle('sidebar-collapsed', e.target.checked);
    await saveSettings({ sidebarCollapsed: e.target.checked });
    toast('Setting saved');
  });

  // ── Clock format ────────────────────────────────────────────────────────────
  container.querySelector('#clock-format-select').addEventListener('change', async e => {
    await saveSettings({ clockFormat: e.target.value });
    toast('Setting saved — reopen tab to update clock');
  });

  // ── Week start ──────────────────────────────────────────────────────────────
  container.querySelector('#week-start-select').addEventListener('change', async e => {
    await saveSettings({ weekStartsOn: parseInt(e.target.value) });
    toast('Setting saved');
  });

  // ── Default view ────────────────────────────────────────────────────────────
  container.querySelector('#default-view-select').addEventListener('change', async e => {
    await saveSettings({ defaultView: e.target.value });
    toast('Setting saved');
  });

  // ── Export ──────────────────────────────────────────────────────────────────
  container.querySelector('#export-btn').addEventListener('click', exportAllData);

  // ── Import backup ────────────────────────────────────────────────────────────
  container.querySelector('#import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    importAllData(file);
    e.target.value = '';
  });

  // ── Google Fonts ─────────────────────────────────────────────────────────────
  function extractFontFamily(importStr) {
    const raw = importStr.replace(/<style[^>]*>|<\/style>/gi, '').trim();
    const urlMatch = raw.match(/url\(['"]?([^'")\s]+)['"]?\)/i);
    const urlStr = urlMatch ? urlMatch[1] : raw;
    try {
      const family = new URL(urlStr).searchParams.get('family');
      if (family) return family.split('|')[0].split(':')[0].split(';')[0].trim();
    } catch {}
    return '';
  }

  const gfImportInput = container.querySelector('#gf-import-input');
  const gfFamilyInput = container.querySelector('#gf-family-input');

  gfImportInput.addEventListener('input', () => {
    const extracted = extractFontFamily(gfImportInput.value.trim());
    if (extracted) gfFamilyInput.value = extracted;
  });

  container.querySelector('#gf-apply-btn').addEventListener('click', async () => {
    const importStr = gfImportInput.value.trim();
    let family = gfFamilyInput.value.trim() || extractFontFamily(importStr);
    if (!importStr) { toast('Paste the @import line', 'error'); return; }
    if (!family) { toast('Could not detect font name — enter it manually', 'error'); return; }
    gfFamilyInput.value = family;
    await saveSettings({ googleFontsImport: importStr, googleFontsFamily: family });
    applyGoogleFont(importStr, family);
    toast(`Font applied: ${family}`);
  });

  container.querySelector('#gf-clear-btn').addEventListener('click', async () => {
    await saveSettings({ googleFontsImport: '', googleFontsFamily: '' });
    applyGoogleFont('', '');
    container.querySelector('#gf-import-input').value = '';
    container.querySelector('#gf-family-input').value = '';
    toast('Reset to system font');
  });

  // ── Font size ─────────────────────────────────────────────────────────────
  const fontSizeLabel = container.querySelector('#font-size-label');
  let currentFontSize = settings.fontSize || 14;

  async function applyFontSize(size) {
    size = Math.min(20, Math.max(11, size));
    currentFontSize = size;
    fontSizeLabel.textContent = size + 'px';
    document.documentElement.style.setProperty('--fs-scale', String(size / 14));
    await saveSettings({ fontSize: size });
  }

  container.querySelector('#font-size-dec').addEventListener('click', () => applyFontSize(currentFontSize - 1));
  container.querySelector('#font-size-inc').addEventListener('click', () => applyFontSize(currentFontSize + 1));

  // ── Import ICS ───────────────────────────────────────────────────────────────
  container.querySelector('#import-ics-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    try {
      toast('Parsing calendar file…');
      const text   = await file.text();
      const events = parseICS(text);

      if (!events.length) {
        toast('No events found in file', 'error');
        return;
      }

      // Upsert all events — re-importing the same file won't create duplicates
      // because each event's id is derived from the ICS UID.
      let count = 0;
      for (const ev of events) {
        await put('events', ev);
        count++;
      }

      toast(`Imported ${count} event${count !== 1 ? 's' : ''} from calendar`);
    } catch (err) {
      console.error('ICS import failed:', err);
      toast('Failed to import calendar file', 'error');
    }
  });
}
