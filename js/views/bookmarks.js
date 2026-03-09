import { getBookmarkData, saveBookmarkData } from '../db/storage.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { makeSortable } from '../utils/drag.js';

function uuid() { return crypto.randomUUID(); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

let data = { bookmarks: [], bookmarkFolders: [] };
let filterText = '';

export async function render(container) {
  data = await getBookmarkData();
  // Ensure a default folder exists
  if (data.bookmarkFolders.length === 0) {
    data.bookmarkFolders.push({ id: uuid(), name: 'General', order: 0 });
    await saveBookmarkData(data);
  }

  container.innerHTML = `
    <div class="bookmarks-view">
      <div class="bookmarks-toolbar">
        <input class="bookmarks-search" id="bm-search" type="search" placeholder="Search bookmarks…" />
        <button class="btn btn-primary" id="bm-add-btn">+ Bookmark</button>
        <button class="btn btn-ghost" id="bm-add-folder-btn">+ Folder</button>
      </div>
      <div id="bm-content"></div>
    </div>
  `;

  renderContent(container);
  bindToolbar(container);
}

function renderContent(container) {
  const content = container.querySelector('#bm-content');
  if (!content) return;
  content.innerHTML = '';

  const sorted_folders = [...data.bookmarkFolders].sort((a, b) => (a.order || 0) - (b.order || 0));

  sorted_folders.forEach(folder => {
    const bms = data.bookmarks
      .filter(bm => bm.folder === folder.id)
      .filter(bm => !filterText || bm.title?.toLowerCase().includes(filterText) || bm.url?.toLowerCase().includes(filterText))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const folderEl = document.createElement('div');
    folderEl.className = 'bookmark-folder';
    folderEl.dataset.folderId = folder.id;

    folderEl.innerHTML = `
      <div class="bookmark-folder-header">
        <span class="folder-toggle-icon">▼</span>
        <span class="bookmark-folder-name">${esc(folder.name)}</span>
        <span class="folder-count" style="font-size:11px;color:var(--text-3)">${bms.length}</span>
        <div class="folder-actions">
          <button class="btn-icon" data-rename-folder="${folder.id}" title="Rename" style="font-size:12px">✎</button>
          <button class="btn-icon" data-delete-folder="${folder.id}" title="Delete folder" style="font-size:12px;color:var(--danger)">✕</button>
        </div>
      </div>
      <div class="bookmark-grid" id="grid-${folder.id}"></div>
    `;

    const grid = folderEl.querySelector(`#grid-${folder.id}`);
    bms.forEach(bm => grid.appendChild(createBookmarkCard(bm, container)));

    // Drag to reorder bookmarks within folder
    makeSortable(grid, '.bookmark-card', (ordered) => {
      ordered.forEach((el, i) => {
        const bm = data.bookmarks.find(b => b.id === el.dataset.id);
        if (bm) bm.order = i;
      });
      saveBookmarkData(data);
    });

    // Folder toggle
    folderEl.querySelector('.bookmark-folder-header').addEventListener('click', e => {
      if (e.target.closest('[data-rename-folder]') || e.target.closest('[data-delete-folder]')) return;
      folderEl.classList.toggle('collapsed');
    });

    // Folder actions
    folderEl.querySelector('[data-rename-folder]')?.addEventListener('click', e => {
      e.stopPropagation();
      renameFolder(folder, folderEl);
    });
    folderEl.querySelector('[data-delete-folder]')?.addEventListener('click', e => {
      e.stopPropagation();
      deleteFolder(folder, container);
    });

    content.appendChild(folderEl);
  });

  // Unfiled bookmarks
  const unfiled = data.bookmarks.filter(bm => !bm.folder || !data.bookmarkFolders.find(f => f.id === bm.folder));
  if (unfiled.length > 0) {
    const unfiledEl = document.createElement('div');
    unfiledEl.className = 'bookmark-folder';
    unfiledEl.innerHTML = `
      <div class="bookmark-folder-header">
        <span class="folder-toggle-icon">▼</span>
        <span class="bookmark-folder-name">Unfiled</span>
        <span class="folder-count" style="font-size:11px;color:var(--text-3)">${unfiled.length}</span>
      </div>
      <div class="bookmark-grid" id="grid-unfiled"></div>
    `;
    const grid = unfiledEl.querySelector('#grid-unfiled');
    unfiled.sort((a,b) => (a.order||0)-(b.order||0)).forEach(bm => grid.appendChild(createBookmarkCard(bm, container)));
    content.appendChild(unfiledEl);
  }

  if (data.bookmarks.length === 0 && !filterText) {
    content.innerHTML += `
      <div class="empty-state">
        <div class="empty-icon">☆</div>
        <div class="empty-title">No bookmarks yet</div>
        <div class="empty-desc">Click "+ Bookmark" to add your first bookmark.</div>
      </div>
    `;
  }
}

function createBookmarkCard(bm, container) {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.dataset.id = bm.id;
  card.draggable = true;
  card.title = bm.title + '\n' + bm.url;

  let faviconHTML;
  if (bm.faviconDataUrl) {
    faviconHTML = `<img src="${bm.faviconDataUrl}" alt="" onerror="this.parentElement.innerHTML='${esc(getInitial(bm.title))}'"/>`;
  } else {
    // Try to auto-load favicon from the URL's domain
    try {
      const domain = new URL(bm.url).hostname;
      faviconHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt=""
        onerror="this.parentElement.innerHTML='${esc(getInitial(bm.title))}'"/>`;
    } catch {
      faviconHTML = `<span>${getInitial(bm.title)}</span>`;
    }
  }

  card.innerHTML = `
    <div class="bookmark-favicon">${faviconHTML}</div>
    <div class="bookmark-label">${esc(bm.title)}</div>
    <div class="bookmark-card-actions">
      <button data-edit="${bm.id}" title="Edit">✎</button>
      <button data-delete-bm="${bm.id}" title="Delete" style="color:var(--danger)">✕</button>
    </div>
  `;

  // Open bookmark
  card.addEventListener('click', e => {
    if (e.target.closest('.bookmark-card-actions')) return;
    const openUrl = bm.url && !bm.url.match(/^[a-zA-Z][\w+\-.]*:\/\//) ? 'https://' + bm.url : bm.url;
    window.open(openUrl, '_blank', 'noopener,noreferrer');
  });

  card.querySelector('[data-edit]')?.addEventListener('click', e => {
    e.stopPropagation();
    showBookmarkModal(bm, container);
  });

  card.querySelector('[data-delete-bm]')?.addEventListener('click', async e => {
    e.stopPropagation();
    modal.confirm({
      title: 'Delete bookmark',
      message: `Delete "<strong>${esc(bm.title)}</strong>"?`,
      onConfirm: async () => {
        data.bookmarks = data.bookmarks.filter(b => b.id !== bm.id);
        await saveBookmarkData(data);
        renderContent(container);
        toast('Bookmark deleted', 'info');
      },
    });
  });

  return card;
}

function bindToolbar(container) {
  container.querySelector('#bm-search').addEventListener('input', e => {
    filterText = e.target.value.toLowerCase();
    renderContent(container);
  });

  container.querySelector('#bm-add-btn').addEventListener('click', () => {
    showBookmarkModal(null, container);
  });

  container.querySelector('#bm-add-folder-btn').addEventListener('click', () => {
    showFolderModal(null, container);
  });
}

function showBookmarkModal(existingBm, container) {
  const bm = existingBm || {
    id: uuid(), title: '', url: '', faviconDataUrl: '', folder: data.bookmarkFolders[0]?.id || '', order: data.bookmarks.length,
  };
  const isNew = !existingBm;

  const folderOptions = data.bookmarkFolders.map(f =>
    `<option value="${esc(f.id)}" ${bm.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`
  ).join('');

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="bm-title" value="${esc(bm.title)}" placeholder="Bookmark title…"/>
    </div>
    <div class="form-group">
      <label>URL</label>
      <input type="url" id="bm-url" value="${esc(bm.url)}" placeholder="https://…"/>
    </div>
    <div class="form-group">
      <label>Folder</label>
      <select id="bm-folder">${folderOptions}</select>
    </div>
    <div class="form-group">
      <label>Custom Favicon (image URL or upload)</label>
      <div class="favicon-input-row">
        <div class="favicon-preview" id="bm-favicon-preview">
          ${bm.faviconDataUrl ? `<img src="${bm.faviconDataUrl}" alt=""/>` : getInitial(bm.title || '?')}
        </div>
        <input type="url" id="bm-favicon-url" placeholder="https://example.com/icon.png" />
      </div>
      <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost" id="bm-fetch-favicon" style="font-size:12px">Load from URL</button>
        <label class="btn btn-ghost" style="font-size:12px;cursor:pointer">
          Upload image
          <input type="file" id="bm-favicon-file" accept="image/*" style="display:none"/>
        </label>
        <button class="btn btn-ghost" id="bm-clear-favicon" style="font-size:12px">Clear</button>
      </div>
    </div>
  `;

  let faviconDataUrl = bm.faviconDataUrl || '';

  modal.open({
    title: isNew ? 'Add Bookmark' : 'Edit Bookmark',
    content: form,
    confirmLabel: isNew ? 'Add Bookmark' : 'Save',
    onConfirm: async (modalEl) => {
      const title = modalEl.querySelector('#bm-title').value.trim();
      let url     = modalEl.querySelector('#bm-url').value.trim();
      if (!title || !url) { toast('Title and URL are required', 'error'); return; }
      if (url && !url.match(/^[a-zA-Z][\w+\-.]*:\/\//)) url = 'https://' + url;
      bm.title         = title;
      bm.url           = url;
      bm.folder        = modalEl.querySelector('#bm-folder').value;
      bm.faviconDataUrl = faviconDataUrl;

      if (isNew) {
        data.bookmarks.push(bm);
      } else {
        const idx = data.bookmarks.findIndex(b => b.id === bm.id);
        if (idx > -1) data.bookmarks[idx] = bm;
      }
      await saveBookmarkData(data);
      modal.close();
      renderContent(container);
      toast(isNew ? 'Bookmark added' : 'Bookmark updated');
    },
  });

  // Favicon fetch
  form.querySelector('#bm-fetch-favicon').addEventListener('click', async () => {
    const url = form.querySelector('#bm-favicon-url').value.trim();
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      faviconDataUrl = await blobToDataUrl(blob);
      updateFaviconPreview(form, faviconDataUrl);
      toast('Favicon loaded');
    } catch {
      toast('Failed to load favicon', 'error');
    }
  });

  // Favicon file upload
  form.querySelector('#bm-favicon-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    faviconDataUrl = await blobToDataUrl(file);
    updateFaviconPreview(form, faviconDataUrl);
  });

  // Clear favicon
  form.querySelector('#bm-clear-favicon').addEventListener('click', () => {
    faviconDataUrl = '';
    const preview = form.querySelector('#bm-favicon-preview');
    preview.innerHTML = getInitial(form.querySelector('#bm-title').value || '?');
  });

  // Auto-update preview when title changes
  form.querySelector('#bm-title').addEventListener('input', e => {
    if (!faviconDataUrl) {
      form.querySelector('#bm-favicon-preview').textContent = getInitial(e.target.value || '?');
    }
  });
}

function updateFaviconPreview(form, dataUrl) {
  const preview = form.querySelector('#bm-favicon-preview');
  preview.innerHTML = dataUrl ? `<img src="${dataUrl}" alt=""/>` : getInitial('?');
}

function showFolderModal(existingFolder, container) {
  const folder = existingFolder || { id: uuid(), name: '', order: data.bookmarkFolders.length };
  const isNew = !existingFolder;

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>Folder name</label>
      <input type="text" id="folder-name" value="${esc(folder.name)}" placeholder="Folder name…"/>
    </div>
  `;

  modal.open({
    title: isNew ? 'New Folder' : 'Rename Folder',
    content: form,
    confirmLabel: isNew ? 'Create Folder' : 'Rename',
    onConfirm: async (modalEl) => {
      const name = modalEl.querySelector('#folder-name').value.trim();
      if (!name) { toast('Name is required', 'error'); return; }
      folder.name = name;
      if (isNew) {
        data.bookmarkFolders.push(folder);
      } else {
        const idx = data.bookmarkFolders.findIndex(f => f.id === folder.id);
        if (idx > -1) data.bookmarkFolders[idx] = folder;
      }
      await saveBookmarkData(data);
      modal.close();
      renderContent(container);
      toast(isNew ? 'Folder created' : 'Folder renamed');
    },
  });
}

function renameFolder(folder, folderEl) {
  const nameEl = folderEl.querySelector('.bookmark-folder-name');
  const oldName = folder.name;
  nameEl.contentEditable = 'true';
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const save = async () => {
    nameEl.contentEditable = 'false';
    const newName = nameEl.textContent.trim();
    if (newName && newName !== oldName) {
      folder.name = newName;
      await saveBookmarkData(data);
      toast('Folder renamed');
    } else {
      nameEl.textContent = oldName;
    }
  };
  nameEl.addEventListener('blur', save, { once: true });
  nameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = oldName; nameEl.blur(); }
  }, { once: true });
}

async function deleteFolder(folder, container) {
  const bmsInFolder = data.bookmarks.filter(b => b.folder === folder.id);
  modal.confirm({
    title: 'Delete folder',
    message: `Delete folder "<strong>${esc(folder.name)}</strong>"?${bmsInFolder.length > 0 ? ` The ${bmsInFolder.length} bookmark(s) inside will become unfiled.` : ''}`,
    onConfirm: async () => {
      // Move bookmarks to unfiled (clear folder)
      bmsInFolder.forEach(b => { b.folder = ''; });
      data.bookmarkFolders = data.bookmarkFolders.filter(f => f.id !== folder.id);
      await saveBookmarkData(data);
      renderContent(container);
      toast('Folder deleted', 'info');
    },
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getInitial(title) {
  return (title || '?')[0].toUpperCase();
}
