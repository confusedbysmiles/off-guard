/**
 * What the tabs are, and what every key does.
 *
 * One table, because there are two readers: `main.js` dispatches keystrokes
 * from it, and the Start here tab prints it. Written twice, they drift, and the
 * way you find out is a GM pressing the key the help page told them to.
 *
 * Descriptions only -- no behaviour. `main.js` owns the actions, keyed by the
 * same ids, and `tests/gm/shortcuts.test.js` holds the two lists to each other:
 * every shortcut described has an action, every action is described.
 */

export const TABS = [
  ['table', 'Table', 'T'],
  ['initiative', 'Initiative', 'I'],
  ['encounters', 'Encounters', 'E'],
  // Everything about this campaign that is not a fight: its settings, who is
  // in it, their links, and what happened last week.
  ['setup', 'Setup', 'S'],
  // Only meaningful for a looping adventure, but a tab that appears and
  // disappears is worse at a table than one that is sometimes empty.
  ['loop', 'Loop', 'L'],
  ['overview', 'All campaigns', 'A'],
  ['start', 'Start here', '?'],
];

/**
 * `when` restricts a shortcut to one tab. `keys` are shown to a person, so
 * they are written the way a keyboard is labelled rather than the way
 * `KeyboardEvent.key` spells them; `matchesKey` maps between the two.
 */
export const SHORTCUTS = [
  ...TABS.map(([id, label, key]) => ({
    id: `tab:${id}`,
    keys: [key],
    group: 'Getting around',
    label,
  })),
  {
    id: 'campaign:switcher',
    keys: ['C'],
    group: 'Getting around',
    label: 'Switch campaign',
    hint: 'Escape closes it again.',
  },
  {
    id: 'campaign:byNumber',
    keys: ['1', '…', '9'],
    group: 'Getting around',
    label: 'Jump straight to a campaign',
    hint: 'In the order they appear under All campaigns. This is the actual '
      + 'gesture — "put me on the Tuesday game" rather than "open a menu".',
  },
  {
    id: 'drawer:reference',
    keys: ['R'],
    group: 'The drawer',
    label: 'Rules reference',
    hint: 'Searches conditions, actions and the rules glossary. Entries link '
      + 'to each other, and every one carries its page citation.',
  },
  {
    id: 'drawer:dice',
    keys: ['D'],
    group: 'The drawer',
    label: 'Dice',
    hint: 'Takes 2d6+3, and 2d20kh1 for a fortune effect. Rolls can be secret; '
      + 'an open one reaches the shared screen.',
  },
  {
    id: 'drawer:recall',
    keys: ['K'],
    group: 'The drawer',
    label: 'Recall Knowledge',
    hint: 'On the Initiative tab this asks about whoever’s turn it is, which is '
      + 'the creature a player has just asked about.',
  },
  {
    id: 'drawer:close',
    keys: ['Esc'],
    group: 'The drawer',
    label: 'Close it',
  },
  {
    id: 'combat:next',
    keys: ['Space', 'N'],
    when: 'initiative',
    group: 'In a fight',
    label: 'Next turn',
    hint: 'The key pressed most often in a session, which is why it is the '
      + 'space bar.',
  },
  {
    id: 'combat:previous',
    keys: ['P'],
    when: 'initiative',
    group: 'In a fight',
    label: 'Previous turn',
    hint: 'For the one that had already been taken.',
  },
];

/** The groups, in the order they should be read. */
export const SHORTCUT_GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

/**
 * Does this event press this key?
 *
 * `…` is the ellipsis in "1 … 9" and is not a key anybody can press; the digit
 * case is handled on its own because it depends on how many campaigns there
 * are, which this module has no business knowing.
 */
export function matchesKey(key, event) {
  if (key === '…' || /^[1-9]$/.test(key)) return false;
  if (key === 'Esc') return event.key === 'Escape';
  if (key === 'Space') return event.key === ' ';
  return event.key.toLowerCase() === key.toLowerCase();
}

/** The shortcut this event fires, given which tab is open, or null. */
export function shortcutFor(event, tab) {
  return SHORTCUTS.find((s) => (
    (!s.when || s.when === tab) && s.keys.some((key) => matchesKey(key, event))
  )) ?? null;
}
