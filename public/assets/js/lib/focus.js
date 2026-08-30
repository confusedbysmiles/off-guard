/**
 * Keeping the caret where the GM left it across a re-render.
 *
 * The dashboard re-renders a whole tab by replacing its children. That is
 * simple and fast and right for a panel nobody is typing into — and wrong the
 * moment somebody is, because the element being typed into is one of the
 * children being replaced.
 *
 * What that looked like: type a letter into creature search, the debounce
 * fires, the results arrive, the tab is rebuilt, and the input the letter went
 * into no longer exists. Focus falls back to `<body>`, where the next keystroke
 * is not a letter any more — it is a keyboard shortcut. Typing "goblin" put the
 * GM on the Initiative tab, twice.
 *
 * So: remember who had focus and where their caret was, re-render, and put both
 * back.
 *
 * Identity is whatever the element already carries — its `id`, or failing that
 * the `aria-label` or `placeholder` it needs anyway to be usable. Deriving it
 * rather than requiring an `id` on every control means a panel written later
 * gets this for free instead of getting it wrong.
 */

/** Elements whose caret position is worth keeping. */
const HAS_CARET = /^(INPUT|TEXTAREA)$/;

/** A selector that will find this element again after its panel is rebuilt. */
function identify(node) {
  if (!node || node === document.body) return null;
  if (!/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(node.tagName)) return null;

  const quote = (value) => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
  if (node.id) return `#${CSS.escape(node.id)}`;
  for (const attribute of ['aria-label', 'placeholder', 'name']) {
    const value = node.getAttribute(attribute);
    if (value) return `${node.tagName.toLowerCase()}[${attribute}=${quote(value)}]`;
  }
  return null;
}

export function preservingFocus(render, root = document) {
  const active = document.activeElement;
  const selector = identify(active);

  // The value as well as the caret. A rebuilt input is built from the state
  // the last completed request produced, so anything typed while that request
  // was in flight would be thrown away -- typing "goblin" at speed left "gobl"
  // in the box. Whoever is typing owns the field; nothing else may write to it.
  const typed = selector && HAS_CARET.test(active.tagName) ? active.value : null;

  let caret = null;
  if (selector && HAS_CARET.test(active.tagName)) {
    try {
      caret = { start: active.selectionStart, end: active.selectionEnd };
    } catch {
      // A number or search input in some browsers refuses to report a
      // selection at all. Focus is the part that matters; the caret is a bonus.
      caret = null;
    }
  }

  render();

  if (!selector) return;
  let restored = null;
  try {
    restored = root.querySelector(selector);
  } catch {
    return;                         // a descriptor that will not parse
  }
  if (!restored || restored === document.activeElement) return;

  // `preventScroll`, because the point is that nothing appears to have
  // happened, and scrolling the panel back into view would undo that.
  restored.focus({ preventScroll: true });
  if (typed !== null && restored.value !== typed) restored.value = typed;
  if (caret && HAS_CARET.test(restored.tagName)) {
    try {
      restored.setSelectionRange(caret.start, caret.end);
    } catch { /* same as above */ }
  }
}
