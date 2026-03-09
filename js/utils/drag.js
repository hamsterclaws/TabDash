/**
 * Generic drag-and-drop reordering helper.
 *
 * Usage:
 *   makeSortable(container, '.item-selector', (newOrderedEls) => {
 *     // newOrderedEls is the array of direct-child elements in their new order
 *   });
 *
 * Each child element must have a `draggable="true"` attribute and a `data-id`.
 * Supports nested containers — only direct children of `container` are dragged.
 */
export function makeSortable(container, selector, onReorder) {
  let dragging = null;

  container.addEventListener('dragstart', e => {
    const el = e.target.closest(selector);
    if (!el || el.parentElement !== container) return;
    dragging = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.id || '');
  });

  container.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('dragging');
    container.querySelectorAll(selector).forEach(el => {
      if (el.parentElement === container) el.classList.remove('drag-over');
    });
    dragging = null;
  });

  container.addEventListener('dragover', e => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest(selector);
    if (!target || target === dragging || target.parentElement !== container) return;

    container.querySelectorAll(selector).forEach(el => {
      if (el.parentElement === container) el.classList.remove('drag-over');
    });
    target.classList.add('drag-over');

    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      container.insertBefore(dragging, target);
    } else {
      container.insertBefore(dragging, target.nextSibling);
    }
  });

  container.addEventListener('dragleave', e => {
    const target = e.target.closest(selector);
    if (target && target.parentElement === container) target.classList.remove('drag-over');
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const ordered = [...container.querySelectorAll(selector)].filter(el => el.parentElement === container);
    ordered.forEach(el => el.classList.remove('drag-over'));
    if (onReorder) onReorder(ordered);
  });
}
