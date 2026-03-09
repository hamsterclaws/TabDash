const overlay = document.getElementById('modal-overlay');

let currentModal = null;

overlay.addEventListener('click', e => {
  if (e.target === overlay) close();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && currentModal) close();
});

/**
 * open({ title, content (HTML string or Element), onConfirm, confirmLabel, confirmClass, wide })
 */
export function open({ title = '', content = '', onConfirm, confirmLabel = 'Confirm', confirmClass = 'btn-primary', wide = false } = {}) {
  overlay.innerHTML = '';

  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <span class="modal-title">${title}</span>
    <button class="btn-icon" id="modal-close-btn" title="Close">✕</button>
  `;
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else {
    body.appendChild(content);
  }
  modal.appendChild(body);

  if (onConfirm) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
      <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
      <button class="btn ${confirmClass}" id="modal-confirm-btn">${confirmLabel}</button>
    `;
    modal.appendChild(footer);
    footer.querySelector('#modal-cancel-btn').addEventListener('click', close);
    footer.querySelector('#modal-confirm-btn').addEventListener('click', () => {
      onConfirm(modal);
    });
  }

  header.querySelector('#modal-close-btn').addEventListener('click', close);

  overlay.appendChild(modal);
  overlay.classList.remove('hidden');
  currentModal = modal;

  // Focus first input
  setTimeout(() => {
    const first = modal.querySelector('input, textarea, select, [contenteditable]');
    if (first) first.focus();
  }, 50);

  return modal;
}

export function close() {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  currentModal = null;
}

export function confirm({ title, message, onConfirm, confirmLabel = 'Delete', confirmClass = 'btn-danger' }) {
  open({
    title,
    content: `<p style="color:var(--text-2);font-size:14px;line-height:1.6">${message}</p>`,
    onConfirm: () => { close(); onConfirm(); },
    confirmLabel,
    confirmClass,
  });
}
