/**
 * Reordering a list, by pointer and by keyboard.
 *
 * Dragging is how a GM breaks an initiative tie, and it is the obvious gesture
 * with a mouse or a finger. It is also completely unavailable to anyone working
 * from the keyboard, which is why this is one module and not three copies of a
 * `dragstart` handler: the keyboard path costs a dozen lines here and would
 * have been skipped three times over.
 *
 * The keyboard path is on the handle: focus it, then Arrow Up or Arrow Down
 * moves that item one place and keeps focus on it, so the item can be walked to
 * where it belongs and the movement is announced by the handle's own label
 * changing position in the list.
 *
 * `onDrop` is given the new order as an array of the `data-<key>` values, which
 * is what every reorder endpoint in this application takes.
 */
export function makeSortable(list, { key, onDrop, itemSelector = ':scope > *' }) {
  if (!list) return;

  // `dataset.combatant` is the attribute `data-combatant`; the keyboard path
  // needs the attribute form to find the row again after a re-render.
  const attribute = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  const items = () => [...list.querySelectorAll(itemSelector)];
  const order = () => items().map((node) => Number(node.dataset[key]));

  let dragging = null;

  list.addEventListener('dragstart', (event) => {
    dragging = event.target.closest(itemSelector);
    if (!dragging) return;
    dragging.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    // Firefox will not start a drag without data on the transfer.
    event.dataTransfer.setData('text/plain', String(dragging.dataset[key] ?? ''));
  });

  list.addEventListener('dragend', () => {
    dragging?.classList.remove('is-dragging');
    dragging = null;
  });

  list.addEventListener('dragover', (event) => {
    if (!dragging) return;
    event.preventDefault();
    const over = event.target.closest(itemSelector);
    if (!over || over === dragging || over.parentElement !== list) return;
    const { top, height } = over.getBoundingClientRect();
    const after = event.clientY > top + height / 2;
    list.insertBefore(dragging, after ? over.nextSibling : over);
  });

  list.addEventListener('drop', (event) => {
    event.preventDefault();
    onDrop(order());
  });

  /**
   * Arrow keys on a handle. `Home` and `End` are deliberately absent: a list
   * this short does not need them, and they would collide with scrolling a
   * panel that happens to have a focused handle in it.
   */
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const handle = event.target.closest('[data-reorder-handle]');
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item) return;

    const sibling = event.key === 'ArrowUp'
      ? item.previousElementSibling
      : item.nextElementSibling;
    if (!sibling) return;

    event.preventDefault();
    if (event.key === 'ArrowUp') list.insertBefore(item, sibling);
    else list.insertBefore(sibling, item);

    // Saving re-renders the list, which replaces this element -- so focus has
    // to be restored *after* that, and by identity rather than by position.
    // Restoring it on the next frame looks right and is not: the render lands
    // later, focus falls to the body, and moving an item two places means
    // finding the handle again in between. Which makes keyboard reordering
    // technically present and practically useless.
    const moved = String(item.dataset[key]);
    Promise.resolve(onDrop(order())).then(() => {
      const again = document.querySelector(
        `[data-${attribute}="${CSS.escape(moved)}"] [data-reorder-handle]`,
      );
      again?.focus();
    });
  });
}

/**
 * The grip.
 *
 * A real button, so it is in the tab order and announces itself. `title` says
 * what a pointer can do and the label says what the keyboard can do, because
 * they are genuinely different affordances on the same control.
 */
export function reorderHandle(el, icon, label) {
  return el('button', {
    class: 'reorder-handle', type: 'button',
    title: 'Drag to reorder',
    'data-reorder-handle': '',
    html: `${icon('grip')}<span class="sr-only">Reorder ${label}. Use the up and down arrows.</span>`,
    // The button itself must not start a drag; its row does.
    draggable: 'false',
  });
}
