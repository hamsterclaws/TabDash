import { setActiveNav } from './components/shell.js';

const VIEW_CONTAINER = document.getElementById('view');

const routes = {};
let currentView = null;
let defaultView = 'dashboard';

export function register(viewId, renderFn) {
  routes[viewId] = renderFn;
}

export function navigate(viewId, state = {}) {
  if (!routes[viewId]) {
    console.warn(`No route for: ${viewId}`);
    return;
  }
  currentView = viewId;
  VIEW_CONTAINER.innerHTML = '';
  setActiveNav(viewId);
  routes[viewId](VIEW_CONTAINER, state);
  history.replaceState(null, '', `#${viewId}`);
}

export function setDefault(viewId) {
  defaultView = viewId;
}

export function start() {
  const hash = location.hash.slice(1);
  navigate(hash && routes[hash] ? hash : defaultView);
}
