/**
 * A guide: sections, and a contents list built from them.
 *
 * Both surfaces have one, and both assemble their sections at render time from
 * what is actually true right now — no campaigns yet, no catalogue on this
 * server, no links handed out — so a first-time GM and one three months in are
 * not reading the same page. Handing somebody instructions for a state they are
 * not in is worse than showing them nothing.
 *
 * The contents list is generated from the same array the sections are. It is
 * the one part of a help page that reliably rots, and the only reliable fix is
 * for there to be nothing to keep in step.
 */
import { el } from './dom.js';

/** A paragraph. Children are nodes or strings; nothing here takes HTML. */
export const p = (...children) => el('p', { class: 'guide__p' }, ...children);

/** A bulleted list. */
export const ul = (...items) => el('ul', { class: 'guide__list' },
  ...items.map((item) => el('li', {}, ...(Array.isArray(item) ? item : [item]))));

/** A sub-heading inside a section. */
export const h3 = (text) => el('h3', { class: 'guide__h3' }, text);

/** Something to press, or type. */
export const kbd = (text) => el('kbd', { class: 'kbd' }, text);

/** Emphasis, for the word in a sentence that carries it. */
export const b = (text) => el('strong', {}, text);

/**
 * @param {object}  options
 * @param {string}  [options.title]     omit for a guide that sits inside
 *                                      something already titled
 * @param {Array}   [options.lead]      nodes shown under the title
 * @param {Array}   options.sections    `{ id, title, body: Node[] }`, already filtered
 * @param {string}  [options.sectionClass]  `panel` on the dashboard, `card` on the sheet
 * @param {string}  [options.headingTag]    so the headings sit at the right depth
 *                                          for wherever this is being put
 */
export function guide({
  title = null,
  lead = [],
  sections,
  sectionClass = 'panel',
  headingTag = 'h2',
}) {
  const heading = (text) => el(headingTag, { class: 'panel__title' }, text);
  const showContents = Boolean(title) && sections.length > 1;

  return el('div', { class: 'guide' },
    title
      ? el('section', { class: `${sectionClass} guide__intro` },
        heading(title),
        ...lead,
        showContents
          ? el('nav', { class: 'guide__toc', 'aria-label': 'On this page' },
            el('p', { class: 'faint guide__toc-label' }, 'On this page'),
            el('ul', { class: 'guide__toc-list' }, ...sections.map((s) => el('li', {},
              el('a', { href: `#${s.id}` }, s.title)))))
          : null)
      : null,

    ...sections.map((s) => el('section', { class: `${sectionClass} guide__section`, id: s.id },
      heading(s.title),
      ...s.body)));
}

/**
 * The keyboard, as a table.
 *
 * Rendered from the same array the dashboard dispatches keystrokes from, so a
 * key that changes changes here too. A help page that names a key which does
 * nothing is worse than one that names no keys at all.
 */
export function shortcutTable(shortcuts, groups) {
  return el('div', { class: 'guide__keys' }, ...groups.map((group) => el('div', {},
    h3(group),
    el('dl', { class: 'keys' }, ...shortcuts
      .filter((s) => s.group === group)
      .flatMap((s) => [
        el('dt', { class: 'keys__key' },
          // "Space or N", but "1 … 9" -- an ellipsis is a range, not a choice.
          ...s.keys.flatMap((key, i) => {
            if (key === '…') return [' … '];
            if (i === 0 || s.keys[i - 1] === '…') return [kbd(key)];
            return [' or ', kbd(key)];
          })),
        el('dd', { class: 'keys__what' },
          el('span', {}, s.label),
          s.hint ? el('span', { class: 'faint keys__hint' }, s.hint) : null),
      ])))));
}
