import { debounce } from '../utils/debounce.js';

const TOOLBAR_BUTTONS = [
  { cmd: 'bold',          label: '<b>B</b>',   title: 'Bold (Ctrl+B)' },
  { cmd: 'italic',        label: '<i>I</i>',   title: 'Italic (Ctrl+I)' },
  { cmd: 'underline',     label: '<u>U</u>',   title: 'Underline (Ctrl+U)' },
  { cmd: 'strikeThrough', label: '<s>S</s>',   title: 'Strikethrough' },
  { sep: true },
  { cmd: 'insertUnorderedList', label: '≡•',   title: 'Bullet list' },
  { cmd: 'insertOrderedList',   label: '1.',   title: 'Numbered list' },
  { sep: true },
  { cmd: 'formatBlock', value: 'h2', label: 'H2', title: 'Heading 2' },
  { cmd: 'formatBlock', value: 'h3', label: 'H3', title: 'Heading 3' },
  { cmd: 'formatBlock', value: 'p',  label: 'P',  title: 'Paragraph' },
  { sep: true },
  { cmd: 'indent',        label: '→',   title: 'Indent' },
  { cmd: 'outdent',       label: '←',   title: 'Outdent' },
  { sep: true },
  { action: 'link',       label: '🔗',  title: 'Insert link' },
  { cmd: 'removeFormat',  label: '✕f',  title: 'Clear formatting' },
];

/**
 * Creates a rich-text editor and appends it to container.
 * Returns { getHTML, setHTML, getWordCount, el }
 */
export function createRichText(container, { placeholder = 'Write something…', onChange } = {}) {
  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'richtext-toolbar';

  TOOLBAR_BUTTONS.forEach(btn => {
    if (btn.sep) {
      const sep = document.createElement('span');
      sep.className = 'richtext-toolbar-sep';
      toolbar.appendChild(sep);
      return;
    }
    const b = document.createElement('button');
    b.className = 'richtext-toolbar-btn';
    b.innerHTML = btn.label;
    b.title = btn.title || '';
    b.type = 'button';
    b.addEventListener('mousedown', e => {
      e.preventDefault(); // keep focus in editor
      if (btn.action === 'link') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(btn.cmd, false, btn.value || null);
      }
      updateActiveStates();
      if (onChange) onChange(getHTML());
    });
    toolbar.appendChild(b);
  });

  // Body
  const body = document.createElement('div');
  body.className = 'richtext-body';
  body.contentEditable = 'true';
  body.setAttribute('data-placeholder', placeholder);

  // Placeholder via CSS :empty::before trick — handled here via attribute
  body.addEventListener('focus', () => {
    if (body.innerHTML === '') body.innerHTML = '';
  });

  const debouncedChange = onChange ? debounce(() => onChange(getHTML()), 500) : null;

  body.addEventListener('input', () => {
    updateWordCount();
    updateActiveStates();
    if (debouncedChange) debouncedChange();
  });

  body.addEventListener('keydown', e => {
    // Tab → indent
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent', false);
    }
  });

  document.addEventListener('selectionchange', updateActiveStates);

  // Word count bar
  const statusBar = document.createElement('div');
  statusBar.className = 'note-status-bar';
  const wordCountEl = document.createElement('span');
  wordCountEl.className = 'note-wordcount';
  wordCountEl.textContent = '0 words';
  const saveIndicator = document.createElement('span');
  saveIndicator.id = 'rt-save-indicator';
  statusBar.appendChild(wordCountEl);
  statusBar.appendChild(saveIndicator);

  container.appendChild(toolbar);
  container.appendChild(body);
  container.appendChild(statusBar);

  function getHTML() {
    return body.innerHTML;
  }

  function setHTML(html) {
    body.innerHTML = html || '';
    updateWordCount();
  }

  function updateWordCount() {
    const text = body.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} chars`;
  }

  function updateActiveStates() {
    toolbar.querySelectorAll('.richtext-toolbar-btn').forEach(btn => {
      const cmd = btn.__cmd;
      if (cmd) {
        btn.classList.toggle('active', document.queryCommandState(cmd));
      }
    });
  }

  // Attach cmd references to buttons
  toolbar.querySelectorAll('.richtext-toolbar-btn').forEach((btn, i) => {
    const def = TOOLBAR_BUTTONS.filter(b => !b.sep)[i];
    if (def && def.cmd) btn.__cmd = def.cmd;
  });

  return { getHTML, setHTML, el: body, toolbar, wordCountEl, saveIndicator };
}
