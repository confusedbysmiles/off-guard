/**
 * The three DOM helpers this application needs.
 *
 * Not a framework. Everything here is a thin wrapper over what the platform
 * already does, kept in one file so the intent is obvious two years from now.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** `el('div', {class: 'card'}, child, 'text')` */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Wait until the user has stopped for `ms`, then run once. */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args) => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

/** `+3` rather than `3`, and `0` rather than `+0`... no: PF2e writes `+0`. */
export const formatMod = (n) => (Number.isFinite(Number(n)) ? `${Number(n) >= 0 ? '+' : ''}${Number(n)}` : '—');

export const titleCase = (s) => String(s ?? '')
  .replace(/[-_]+/g, ' ')
  .replace(/\b[a-z]/g, (c) => c.toUpperCase());
