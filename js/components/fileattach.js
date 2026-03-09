import { put, remove, getByIndex } from '../db/idb.js';
import { toast } from './toast.js';

function uuid() {
  return crypto.randomUUID();
}

function fileIcon(mime) {
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf'))      return '📄';
  if (mime.includes('zip') || mime.includes('tar')) return '📦';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  return '📎';
}

/**
 * Renders a file attachment UI inside container.
 * parentType: 'note' | 'event'
 * parentId: string
 * Returns { load(), refresh() }
 */
export function createFileAttach(container, { parentType, parentId, onUpdate } = {}) {
  const row = document.createElement('div');
  row.className = 'attachments-row';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost';
  addBtn.style.fontSize = '12px';
  addBtn.innerHTML = '+ Attach file';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';

  addBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    for (const file of files) {
      const id = uuid();
      const record = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: file,
        parentType,
        parentId,
        createdAt: Date.now(),
      };
      await put('attachments', record);
    }
    fileInput.value = '';
    await refresh();
    if (onUpdate) onUpdate();
    toast('File attached');
  });

  row.appendChild(fileInput);

  async function refresh() {
    // Remove existing thumbs
    row.querySelectorAll('.attachment-thumb').forEach(el => el.remove());

    const attachments = await getByIndex('attachments', 'parentId', parentId);
    for (const att of attachments) {
      const thumb = document.createElement('div');
      thumb.className = 'attachment-thumb';
      thumb.title = att.name;

      if (att.type.startsWith('image/')) {
        const url = URL.createObjectURL(att.blob);
        const img = document.createElement('img');
        img.src = url;
        img.alt = att.name;
        img.addEventListener('load', () => URL.revokeObjectURL(url));
        thumb.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'attach-icon';
        icon.textContent = fileIcon(att.type);
        thumb.appendChild(icon);
      }

      // Delete button
      const del = document.createElement('button');
      del.className = 'attach-delete';
      del.textContent = '✕';
      del.title = 'Remove attachment';
      del.addEventListener('click', async e => {
        e.stopPropagation();
        await remove('attachments', att.id);
        await refresh();
        if (onUpdate) onUpdate();
        toast('Attachment removed', 'info');
      });
      thumb.appendChild(del);

      // Click to download/view
      thumb.addEventListener('click', e => {
        if (e.target === del) return;
        const url = URL.createObjectURL(att.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = att.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });

      row.insertBefore(thumb, addBtn);
    }
  }

  row.appendChild(addBtn);
  container.appendChild(row);

  return { refresh };
}
