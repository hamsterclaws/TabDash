// chrome.storage wrappers returning Promises

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentColor: '#2dd4bf',
  clockFormat: '12h',
  weekStartsOn: 0,
  defaultView: 'dashboard',
  sidebarCollapsed: false,
  brandName: 'Productivity',
  googleFontsImport: '',
  googleFontsFamily: '',
};

export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

export function saveSettings(partial) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(partial, resolve);
  });
}

export function getBookmarkData() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ bookmarks: [], bookmarkFolders: [] }, resolve);
  });
}

export function saveBookmarkData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

// Dashboard widget config
const DEFAULT_WIDGETS = [
  { id: 'clock',     label: 'Clock & Date',     enabled: true,  order: 0 },
  { id: 'bookmarks', label: 'Quick Bookmarks',  enabled: true,  order: 1 },
  { id: 'events',    label: "Upcoming Schedule", enabled: true,  order: 2 },
  { id: 'notes',     label: 'Pinned Notes',      enabled: true,  order: 3 },
  { id: 'goals',     label: 'Active Goals',      enabled: true,  order: 4 },
  { id: 'meetings',  label: 'Upcoming Meetings', enabled: false, order: 5 },
];

export function getWidgetConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ dashWidgets: DEFAULT_WIDGETS }, (r) => {
      const stored = r.dashWidgets;
      // Merge: add any default widgets not yet in stored config (migration)
      const merged = [...stored];
      for (const def of DEFAULT_WIDGETS) {
        if (!merged.find(w => w.id === def.id)) {
          merged.push({ ...def, order: merged.length });
        }
      }
      resolve(merged);
    });
  });
}

export function saveWidgetConfig(widgets) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ dashWidgets: widgets }, resolve);
  });
}
