/**
 * Notices.
 *
 * One region, `aria-live`, at the top of the page. Every destructive action in
 * the dashboard puts its undo here rather than behind a confirmation dialog:
 * a dialog interrupts a GM mid-sentence, and an undo does not.
 */
import { el } from './dom.js';
import { icon } from './icons.js';

export function createNotices(host) {
  function show(message, { kind = 'warn', actions = [], detail = null, timeout = null } = {}) {
    const node = el('div', { class: `notice notice--${kind}` },
      el('div', { class: 'notice__body' },
        el('strong', {}, message),
        detail ? el('p', { class: 'muted' }, detail) : null,
        actions.length
          ? el('div', { class: 'notice__actions' }, ...actions.map(([label, fn]) => el('button', {
            class: 'btn', type: 'button',
            onclick: async () => { node.remove(); await fn(); },
          }, label)))
          : null),
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        html: `${icon('x')}<span class="sr-only">Dismiss</span>`,
        onclick: () => node.remove(),
      }));

    host.append(node);
    const life = timeout ?? (kind === 'info' ? 6000 : null);
    if (life) setTimeout(() => node.remove(), life);
    return node;
  }

  return {
    show,
    info: (message, options) => show(message, { ...options, kind: 'info' }),
    warn: (message, options) => show(message, { ...options, kind: 'warn' }),
    error: (message, options) => show(message, { ...options, kind: 'bad' }),
    clear: () => host.replaceChildren(),
  };
}
