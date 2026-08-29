/**
 * Icons.
 *
 * SVG paths, drawn as 24x24 line icons on `currentColor`. No emoji anywhere in
 * the interface: emoji render differently on every platform, carry a colour the
 * theme does not control, and are read aloud by a screen reader as whatever
 * their Unicode name happens to be.
 *
 * Every icon button gets a label from `icon()`'s caller, not from the icon.
 */
const PATHS = {
  check:      'M20 6 9 17l-5-5',
  x:          'M18 6 6 18M6 6l12 12',
  plus:       'M12 5v14M5 12h14',
  minus:      'M5 12h14',
  chevron:    'M9 18l6-6-6-6',
  chevronDown:'M6 9l6 6 6-6',
  undo:       'M3 7v6h6M3.5 13a9 9 0 1 0 2.3-6.4L3 9',
  cloud:      'M17.5 19a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 6.5 19z',
  cloudOff:   'M3 3l18 18M17.5 19a4.5 4.5 0 0 0 .8-8.9M8 6.6A6 6 0 0 1 17.8 10M6.2 11.6A3.7 3.7 0 0 0 6.5 19h8',
  shield:     'M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6z',
  heart:      'M12 20s-7-4.3-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7c0 5-7 9.3-7 9.3z',
  eye:        'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  print:      'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z',
  upload:     'M12 16V4M8 8l4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  sun:        'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon:       'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  alert:      'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  dice:       'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01',
  book:       'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM18 7h2v13H7',
  screen:     'M3 4h18v12H3z M8 20h8 M12 16v4',
  phone:      'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2',
  // Recall Knowledge: what the party knows about the thing in front of them.
  question:   'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.2 9.2a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4 M12 17h.01',
  // Persistent damage, which is the only thing in the tracker that keeps
  // happening after the turn that caused it.
  flame:      'M12 22a6 6 0 0 0 6-6c0-4-3-5-3-9 0 0-3 1.5-3 5 0-2-1.5-3-1.5-3S9 11 9 13c0-1.5-1-2-1-2a6.6 6.6 0 0 0-2 5 6 6 0 0 0 6 6z',
};

export const ICON_NAMES = Object.keys(PATHS);

/**
 * Markup for one icon.
 *
 * Always `aria-hidden`: the accessible name belongs to the control, so a button
 * says "Undo last change" once rather than twice.
 */
export function icon(name, { className = 'icon' } = {}) {
  const d = PATHS[name];
  if (!d) throw new Error(`No icon named ${name}`);
  const paths = d.split(' M').map((segment, i) => (i === 0 ? segment : `M${segment}`));
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
    + paths.map((p) => `<path d="${p}"/>`).join('')
    + '</svg>';
}
