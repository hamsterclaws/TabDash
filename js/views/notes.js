import { getAll, put, remove, getById } from '../db/idb.js';
import { createFileAttach } from '../components/fileattach.js';
import { toast } from '../components/toast.js';
import * as modal from '../components/modal.js';
import { debounce } from '../utils/debounce.js';
import { emit } from '../utils/eventbus.js';
import { friendlyDate, todayISO } from '../utils/date.js';
import { makeSortable } from '../utils/drag.js';

function uuid() { return crypto.randomUUID(); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function stripHTML(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }

// Extract plain text from block tree (for search / preview)
function noteText(note) {
  if (note.blocks && note.blocks.length) {
    const texts = [];
    function collect(blocks) { (blocks || []).forEach(b => { texts.push(stripHTML(b.content || '')); collect(b.children); }); }
    collect(note.blocks);
    return texts.join(' ');
  }
  return stripHTML(note.body || '');
}

let allNotes    = [];
let activeId    = null;
let attachCtrl  = null;
let filterText  = '';
let collapsedIds = new Set();
let cleanupOutliner = null;

export async function render(container, state = {}) {
  if (cleanupOutliner) { cleanupOutliner(); cleanupOutliner = null; }
  if (state.openId) activeId = state.openId;
  allNotes = await getAll('notes');

  container.innerHTML = `
    <div class="two-panel">
      <div class="panel-left">
        <div class="notes-list-header">
          <div class="notes-list-header-row">
            <span style="font-size:13px;font-weight:700">Notes</span>
            <button class="btn btn-primary" id="new-note-btn" style="font-size:12px;padding:4px 10px">+ New</button>
          </div>
          <input class="search-input" id="note-search" type="search" placeholder="Search notes…" />
        </div>
        <div class="panel-list" id="notes-list"></div>
      </div>
      <div class="panel-right" id="note-editor-pane">
        <div class="empty-state">
          <div class="empty-icon">✎</div>
          <div class="empty-title">Select a note</div>
          <div class="empty-desc">Choose a note from the list or create a new one.</div>
        </div>
      </div>
    </div>
  `;

  renderList(container);
  bindSearch(container);
  container.querySelector('#new-note-btn').addEventListener('click', () => createNote(container));
  if (activeId) openNote(container, activeId);
}

// ── Block tree helpers ────────────────────────────────────────────────────────

function flatBlocks(blocks) {
  const result = [];
  function traverse(arr) { (arr || []).forEach(b => { result.push(b); traverse(b.children); }); }
  traverse(blocks);
  return result;
}

function findBlock(blocks, targetId) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === targetId) return { siblings: blocks, index: i };
    const found = findBlock(blocks[i].children || [], targetId);
    if (found) return found;
  }
  return null;
}

function findBlockWithAncestor(blocks, targetId, parentSiblings = null, parentIndex = -1) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === targetId) return { siblings: blocks, index: i, parentSiblings, parentIndex };
    const found = findBlockWithAncestor(blocks[i].children || [], targetId, blocks, i);
    if (found) return found;
  }
  return null;
}

function isCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.getRangeAt(0).collapsed) return false;
  const r = sel.getRangeAt(0);
  const test = document.createRange();
  test.selectNodeContents(el);
  test.collapse(true);
  return r.compareBoundaryPoints(Range.START_TO_START, test) === 0;
}

function isCaretAtEnd(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.getRangeAt(0).collapsed) return false;
  const r = sel.getRangeAt(0);
  const test = document.createRange();
  test.selectNodeContents(el);
  test.collapse(false);
  return r.compareBoundaryPoints(Range.END_TO_END, test) === 0;
}

// ── Outliner ──────────────────────────────────────────────────────────────────

function buildOutliner(note, onSave) {
  // Migrate old body → single block
  if (!note.blocks || !note.blocks.length) {
    note.blocks = [{ id: uuid(), content: note.body || '', children: [] }];
  }

  const schedSave = debounce(onSave, 600);
  const outliner = document.createElement('div');
  outliner.className = 'note-outliner';

  // ── Floating rich-text toolbar ─────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'block-toolbar';
  toolbar.innerHTML = `
    <button class="block-toolbar-btn" data-cmd="bold"         title="Bold"><b>B</b></button>
    <button class="block-toolbar-btn" data-cmd="italic"       title="Italic"><i>I</i></button>
    <button class="block-toolbar-btn" data-cmd="underline"    title="Underline"><u>U</u></button>
    <button class="block-toolbar-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
    <div class="block-toolbar-sep"></div>
    <button class="block-toolbar-btn" data-cmd="code"  title="Inline code"><code>\`\`</code></button>
    <button class="block-toolbar-btn" data-cmd="link"  title="Link">⇗</button>
  `;
  document.body.appendChild(toolbar);

  toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === 'code') {
        wrapWith('code');
      } else if (cmd === 'link') {
        const url = prompt('URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  function wrapWith(tag) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    if (!text) return;
    try {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const el = document.createElement(tag);
      el.textContent = text;
      range.insertNode(el);
      range.setStartAfter(el);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      document.execCommand('insertHTML', false, `<${tag}>${esc(text)}</${tag}>`);
    }
    schedSave();
  }

  const onSelChange = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      toolbar.style.display = '';
      return;
    }
    try {
      const range = sel.getRangeAt(0);
      if (!outliner.contains(range.commonAncestorContainer)) { toolbar.style.display = ''; return; }
      const rect = range.getBoundingClientRect();
      toolbar.style.display = 'flex';
      toolbar.style.top  = `${rect.top}px`;
      toolbar.style.left = `${rect.left + rect.width / 2}px`;
    } catch { toolbar.style.display = ''; }
  };
  document.addEventListener('selectionchange', onSelChange);

  // ── Block rendering ───────────────────────────────────────────────────────

  function rerender() {
    outliner.innerHTML = '';
    (note.blocks || []).forEach(b => outliner.appendChild(makeBlockEl(b)));
  }

  function makeBlockEl(block) {
    const node = document.createElement('div');
    node.className = 'block-node';
    node.dataset.id = block.id;

    const row = document.createElement('div');
    row.className = 'block-row';

    // Handle (shows bullet, collapses on click if has children)
    const handle = document.createElement('div');
    handle.className = 'block-handle';
    const bullet = document.createElement('div');
    bullet.className = 'block-bullet';
    bullet.addEventListener('click', () => {
      if (!block.children || !block.children.length) return;
      node.classList.toggle('block-collapsed');
      const ch = node.querySelector(':scope > .block-children');
      if (ch) ch.style.display = node.classList.contains('block-collapsed') ? 'none' : '';
    });
    handle.appendChild(bullet);

    // Content (contenteditable)
    const content = document.createElement('div');
    content.className = 'block-content';
    content.contentEditable = 'true';
    content.dataset.placeholder = 'Type something…';
    content.innerHTML = block.content || '';

    content.addEventListener('input', () => {
      block.content = content.innerHTML;
      schedSave();
    });
    content.addEventListener('keydown', e => onKeydown(e, block, content));

    row.appendChild(handle);
    row.appendChild(content);
    node.appendChild(row);

    if (block.children && block.children.length) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'block-children';
      block.children.forEach(ch => childrenEl.appendChild(makeBlockEl(ch)));
      node.appendChild(childrenEl);
    }

    return node;
  }

  function focusBlock(blockId, atEnd = true) {
    const el = outliner.querySelector(`.block-node[data-id="${blockId}"] > .block-row > .block-content`);
    if (!el) return;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(!atEnd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  // ── Keyboard handling ─────────────────────────────────────────────────────

  function onKeydown(e, block, contentEl) {
    const flat = flatBlocks(note.blocks);
    const idx  = flat.findIndex(b => b.id === block.id);

    // Enter → new sibling block
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const nb = { id: uuid(), content: '', children: [] };
      const info = findBlock(note.blocks, block.id);
      if (info) info.siblings.splice(info.index + 1, 0, nb);
      rerender();
      focusBlock(nb.id, false);
      schedSave();

    // Tab → indent (become last child of previous sibling)
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const info = findBlock(note.blocks, block.id);
      if (!info || info.index === 0) return;
      const prev = info.siblings[info.index - 1];
      info.siblings.splice(info.index, 1);
      if (!prev.children) prev.children = [];
      prev.children.push(block);
      rerender();
      focusBlock(block.id);
      schedSave();

    // Shift+Tab → unindent (move to parent's next sibling)
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const info = findBlockWithAncestor(note.blocks, block.id);
      if (!info || !info.parentSiblings) return; // already top-level
      info.siblings.splice(info.index, 1);
      // Remaining siblings after this become this block's children
      const trailing = info.siblings.splice(info.index);
      block.children = [...(block.children || []), ...trailing];
      info.parentSiblings.splice(info.parentIndex + 1, 0, block);
      rerender();
      focusBlock(block.id);
      schedSave();

    // Backspace on empty block → remove
    } else if (e.key === 'Backspace' && !contentEl.textContent && !contentEl.innerHTML.trim()) {
      e.preventDefault();
      if (flat.length <= 1) return;
      const info = findBlock(note.blocks, block.id);
      if (!info) return;
      if (block.children && block.children.length) {
        info.siblings.splice(info.index + 1, 0, ...block.children);
      }
      info.siblings.splice(info.index, 1);
      rerender();
      if (idx > 0) focusBlock(flat[idx - 1].id, true);
      schedSave();

    // Arrow navigation between blocks
    } else if (e.key === 'ArrowUp' && isCaretAtStart(contentEl)) {
      e.preventDefault();
      if (idx > 0) focusBlock(flat[idx - 1].id, true);
    } else if (e.key === 'ArrowDown' && isCaretAtEnd(contentEl)) {
      e.preventDefault();
      if (idx < flat.length - 1) focusBlock(flat[idx + 1].id, false);
    }
  }

  rerender();
  // Auto-focus first block if note is new/empty
  if (note.blocks.length === 1 && !note.blocks[0].content) {
    setTimeout(() => focusBlock(note.blocks[0].id, false), 30);
  }

  return {
    el: outliner,
    cleanup() {
      document.removeEventListener('selectionchange', onSelChange);
      toolbar.remove();
    },
  };
}

// ── Note list (hierarchical) ──────────────────────────────────────────────────

function buildChildrenOf(notes) {
  const map = new Map();
  for (const n of notes) {
    const key = n.parentId || null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  }
  for (const [, group] of map) {
    const allHaveOrder = group.every(n => n.order !== undefined);
    if (allHaveOrder) group.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    else group.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return map;
}

function getDescendantIds(noteId) {
  const ids = new Set();
  function collect(id) { allNotes.filter(n => n.parentId === id).forEach(n => { ids.add(n.id); collect(n.id); }); }
  collect(noteId);
  return ids;
}

async function saveNoteOrder(ordered) {
  ordered.forEach((el, i) => { const n = allNotes.find(n => n.id === el.dataset.id); if (n) n.order = i; });
  for (const el of ordered) { const n = allNotes.find(n => n.id === el.dataset.id); if (n) await put('notes', n); }
}

function renderList(container) {
  const list = container.querySelector('#notes-list');
  if (!list) return;

  if (filterText) {
    const q = filterText.toLowerCase();
    const filtered = allNotes
      .filter(n => n.title?.toLowerCase().includes(q) || noteText(n).toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!filtered.length) { list.innerHTML = '<div class="empty-state"><div class="empty-desc">No results</div></div>'; return; }
    list.innerHTML = filtered.map(n => `
      <div class="note-item ${n.id === activeId ? 'active' : ''}" data-id="${n.id}">
        <div class="note-item-title">${esc(n.title || 'Untitled')}</div>
        <div class="note-item-preview">${esc(noteText(n).slice(0, 60))}</div>
        <div class="note-item-meta">
          ${n.pinned ? '<span class="tag tag-accent">Pinned</span>' : ''}
          <span class="note-item-date">${friendlyDate(new Date(n.updatedAt || n.createdAt))}</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.note-item').forEach(el => el.addEventListener('click', () => openNote(container, el.dataset.id)));
    return;
  }

  const childrenOf = buildChildrenOf(allNotes);
  list.innerHTML = '';
  if (!allNotes.length) { list.innerHTML = '<div class="empty-state"><div class="empty-desc">No notes yet</div></div>'; return; }
  buildNoteGroup(list, childrenOf.get(null) || [], childrenOf, container);
  makeSortable(list, '.note-tree-node', saveNoteOrder);
}

function buildNoteGroup(container, notes, childrenOf, viewContainer) {
  notes.forEach(note => {
    const children   = childrenOf.get(note.id) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsedIds.has(note.id);

    const node = document.createElement('div');
    node.className = 'note-tree-node';
    node.dataset.id = note.id;
    node.draggable = true;

    const inner = document.createElement('div');
    inner.className = `note-item-inner note-item${note.id === activeId ? ' active' : ''}`;
    inner.dataset.id = note.id;

    const expandBtn = document.createElement('button');
    expandBtn.className = 'note-expand-btn' +
      (hasChildren ? '' : ' note-expand-hidden') +
      (hasChildren && !isCollapsed ? ' expanded' : '');
    expandBtn.textContent = '▶';
    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (collapsedIds.has(note.id)) collapsedIds.delete(note.id);
      else collapsedIds.add(note.id);
      renderList(viewContainer);
    });
    inner.appendChild(expandBtn);

    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;';
    content.innerHTML = `
      <div class="note-item-title">${esc(note.title || 'Untitled')}</div>
      <div class="note-item-preview">${esc(noteText(note).slice(0, 60))}</div>
      <div class="note-item-meta">
        ${note.pinned ? '<span class="tag tag-accent">Pinned</span>' : ''}
        <span class="note-item-date">${friendlyDate(new Date(note.updatedAt || note.createdAt))}</span>
      </div>
    `;
    inner.appendChild(content);
    inner.addEventListener('click', e => { if (!e.target.closest('.note-expand-btn')) openNote(viewContainer, note.id); });
    node.appendChild(inner);

    const childrenEl = document.createElement('div');
    childrenEl.className = 'note-children';
    childrenEl.dataset.parentId = note.id;
    if (isCollapsed) childrenEl.style.display = 'none';
    if (hasChildren && !isCollapsed) {
      buildNoteGroup(childrenEl, children, childrenOf, viewContainer);
      makeSortable(childrenEl, '.note-tree-node', saveNoteOrder);
    }
    node.appendChild(childrenEl);
    container.appendChild(node);
  });
}

function bindSearch(container) {
  container.querySelector('#note-search').addEventListener('input', e => { filterText = e.target.value; renderList(container); });
}

async function createNote(container) {
  const note = {
    id: uuid(), title: '', body: '',
    blocks: [{ id: uuid(), content: '', children: [] }],
    tags: [], linkedDates: [todayISO()], attachments: [],
    pinned: false, parentId: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await put('notes', note);
  allNotes.unshift(note);
  activeId = note.id;
  renderList(container);
  openNote(container, note.id);
  emit('note-saved', note);
}

// ── Note editor ───────────────────────────────────────────────────────────────

async function openNote(container, id) {
  if (cleanupOutliner) { cleanupOutliner(); cleanupOutliner = null; }
  activeId = id;
  renderList(container);
  const note = allNotes.find(n => n.id === id) || await getById('notes', id);
  if (!note) return;

  const pane = container.querySelector('#note-editor-pane');
  pane.innerHTML = '';

  const editor = document.createElement('div');
  editor.className = 'note-editor';
  pane.appendChild(editor);

  // Title
  const titleInput = document.createElement('input');
  titleInput.className = 'note-title-input';
  titleInput.placeholder = 'Note title…';
  titleInput.value = note.title || '';
  editor.appendChild(titleInput);

  // Action buttons
  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;';
  actionsRow.innerHTML = `
    <button class="btn btn-ghost" id="pin-btn" style="font-size:12px">${note.pinned ? '★ On Dashboard' : '☆ Pin to Dashboard'}</button>
    <button class="btn btn-primary" id="save-note-btn" style="font-size:12px">Save</button>
    <button class="btn btn-danger" id="delete-note-btn" style="font-size:12px">Delete</button>
    <span id="auto-save-indicator" style="font-size:11px;color:var(--text-3);margin-left:auto"></span>
  `;
  editor.appendChild(actionsRow);

  // Parent note selector
  const descendants = getDescendantIds(note.id);
  const eligibleParents = allNotes.filter(n => n.id !== note.id && !descendants.has(n.id));
  const parentRow = document.createElement('div');
  parentRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
  parentRow.innerHTML = `
    <label style="font-size:12px;color:var(--text-3);white-space:nowrap;flex-shrink:0;">Parent note:</label>
    <select id="parent-note-select" style="flex:1;font-size:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);">
      <option value="">— None (top-level) —</option>
      ${eligibleParents.map(n => `<option value="${n.id}" ${note.parentId === n.id ? 'selected' : ''}>${esc(n.title || 'Untitled')}</option>`).join('')}
    </select>
  `;
  parentRow.querySelector('#parent-note-select').addEventListener('change', async e => {
    note.parentId = e.target.value || null;
    await saveNote();
    renderList(container);
  });
  editor.appendChild(parentRow);

  // Outliner (block content)
  const { el: outlinerEl, cleanup } = buildOutliner(note, saveNote);
  cleanupOutliner = cleanup;
  editor.appendChild(outlinerEl);

  // Meta section
  const metaRow = document.createElement('div');
  metaRow.className = 'note-meta-row';

  // Tags
  const tagsSection = document.createElement('div');
  tagsSection.innerHTML = `<div class="section-title" style="margin-bottom:6px">Tags</div>`;
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'tags-container';
  tagsSection.appendChild(tagsContainer);
  metaRow.appendChild(tagsSection);
  let tags = [...(note.tags || [])];
  renderTags(tagsContainer, tags, () => saveNote());

  // Attachments (per note)
  const attachSection = document.createElement('div');
  attachSection.innerHTML = `<div class="section-title" style="margin-bottom:6px">Attachments</div>`;
  metaRow.appendChild(attachSection);
  attachCtrl = createFileAttach(attachSection, { parentType: 'note', parentId: note.id });
  attachCtrl.refresh();

  // Linked dates
  const datesSection = document.createElement('div');
  datesSection.innerHTML = `<div class="section-title" style="margin-bottom:6px">Linked Dates</div>`;
  const datesRow = document.createElement('div');
  datesRow.className = 'linked-dates-row';
  datesSection.appendChild(datesRow);
  metaRow.appendChild(datesSection);
  let linkedDates = [...(note.linkedDates || [])];
  renderLinkedDates(datesRow, linkedDates, async () => { note.linkedDates = linkedDates; await saveNote(); });

  const addDateBtn = document.createElement('button');
  addDateBtn.className = 'btn btn-ghost';
  addDateBtn.style.fontSize = '12px';
  addDateBtn.textContent = '+ Link date';
  addDateBtn.addEventListener('click', () => {
    const di = document.createElement('input');
    di.type = 'date';
    di.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(di);
    di.showPicker?.();
    di.addEventListener('change', async () => {
      if (di.value && !linkedDates.includes(di.value)) {
        linkedDates.push(di.value);
        note.linkedDates = linkedDates;
        await saveNote();
        renderLinkedDates(datesRow, linkedDates, async () => { note.linkedDates = linkedDates; await saveNote(); });
      }
      di.remove();
    });
    di.click();
  });
  datesRow.appendChild(addDateBtn);
  editor.appendChild(metaRow);

  // Auto-save wiring
  const saveIndicator = actionsRow.querySelector('#auto-save-indicator');
  const debouncedTitleSave = debounce(saveNote, 800);
  titleInput.addEventListener('input', () => {
    note.title = titleInput.value;
    debouncedTitleSave();
    const listInner = container.querySelector(`.note-item-inner[data-id="${note.id}"] .note-item-title`);
    if (listInner) listInner.textContent = note.title || 'Untitled';
  });

  actionsRow.querySelector('#save-note-btn').addEventListener('click', () => saveNote());
  editor.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNote(); } });

  actionsRow.querySelector('#pin-btn').addEventListener('click', async () => {
    note.pinned = !note.pinned;
    actionsRow.querySelector('#pin-btn').textContent = note.pinned ? '★ On Dashboard' : '☆ Pin to Dashboard';
    await saveNote();
    renderList(container);
  });

  actionsRow.querySelector('#delete-note-btn').addEventListener('click', () => {
    modal.confirm({
      title: 'Delete note',
      message: `Delete "<strong>${esc(note.title || 'Untitled')}</strong>"? This cannot be undone.`,
      onConfirm: async () => {
        if (cleanupOutliner) { cleanupOutliner(); cleanupOutliner = null; }
        await remove('notes', note.id);
        allNotes = allNotes.filter(n => n.id !== note.id);
        activeId = null;
        renderList(container);
        pane.innerHTML = `<div class="empty-state"><div class="empty-icon">✎</div><div class="empty-title">Note deleted</div></div>`;
        toast('Note deleted', 'info');
        emit('note-saved', null);
      },
    });
  });

  async function saveNote() {
    note.title     = titleInput.value;
    note.body      = noteText(note);  // plain text for search / preview
    note.tags      = tags;
    note.updatedAt = Date.now();
    await put('notes', note);
    const idx = allNotes.findIndex(n => n.id === note.id);
    if (idx > -1) allNotes[idx] = { ...note }; else allNotes.unshift({ ...note });
    const listInner = container.querySelector(`.note-item-inner[data-id="${note.id}"]`);
    if (listInner) {
      const t = listInner.querySelector('.note-item-title');
      const p = listInner.querySelector('.note-item-preview');
      if (t) t.textContent = note.title || 'Untitled';
      if (p) p.textContent = noteText(note).slice(0, 60);
    }
    if (saveIndicator) {
      saveIndicator.textContent = 'Saved';
      setTimeout(() => { if (saveIndicator) saveIndicator.textContent = ''; }, 1500);
    }
    emit('note-saved', note);
  }
}

// ── Tag & date helpers ────────────────────────────────────────────────────────

function renderTags(container, tags, onChange) {
  container.querySelectorAll('.tag').forEach(el => el.remove());
  tags.forEach((tag, i) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${esc(tag)} <span data-i="${i}">×</span>`;
    el.querySelector('span').addEventListener('click', () => { tags.splice(i, 1); renderTags(container, tags, onChange); onChange(); });
    container.insertBefore(el, container.querySelector('.tag-input') || null);
  });
  let inp = container.querySelector('.tag-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.className = 'tag-input';
    inp.placeholder = 'Add tag…';
    inp.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
        e.preventDefault();
        const t = inp.value.trim().replace(/,/g, '');
        if (!tags.includes(t)) { tags.push(t); renderTags(container, tags, onChange); onChange(); }
        inp.value = '';
      }
      if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); renderTags(container, tags, onChange); onChange(); }
    });
    container.appendChild(inp);
  }
}

function renderLinkedDates(container, dates, onChange) {
  container.querySelectorAll('.linked-date-chip').forEach(el => el.remove());
  dates.forEach((d, i) => {
    const chip = document.createElement('span');
    chip.className = 'linked-date-chip';
    chip.innerHTML = `${d} <button data-i="${i}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { dates.splice(i, 1); renderLinkedDates(container, dates, onChange); onChange(); });
    container.insertBefore(chip, container.lastElementChild);
  });
}
