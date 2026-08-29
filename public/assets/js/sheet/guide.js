/**
 * Start here, for the player.
 *
 * A sheet is opened for the first time on a phone, at a table, by somebody who
 * was handed a link and told "that's yours". This is the card that answers the
 * three questions they actually have: is this saved, who else can see it, and
 * what happens when the wifi goes.
 *
 * It is a `<details>`, open the first time and closed after that, because it is
 * the right length to read once and the wrong length to scroll past every
 * session. What it says depends on the sheet: a character with nothing filled
 * in gets told how to fill it in, one mid-session does not.
 */
import { el } from '../lib/dom.js';
import { b, guide, h3, kbd, p, ul } from '../lib/guide.js';

const KEY = 'off-guard:guide-seen';

const seen = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};
const remember = () => {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode: this session only */ }
};

export function guideCard(sheet, { onImport }) {
  const name = (sheet?.name ?? '').trim();
  const blank = !name && !sheet?.class && !sheet?.level;
  const conditions = sheet?.conditions ?? [];

  const sections = [];

  if (blank) {
    sections.push({
      id: 'guide-fill',
      title: 'Filling this in',
      body: [
        p('This sheet is empty. Two ways to change that:'),
        ul(
          [b('Import it.'), ' If you build in Pathbuilder, export the JSON from '
            + 'there and ', el('button', {
            class: 'link-button', type: 'button', onclick: onImport,
          }, 'upload the file'), '. Everything comes across — attributes, '
            + 'proficiencies, strikes with their runes, spells.'],
          [b('Type it.'), ' Every box is editable and saves as you go.'],
        ),
        p('Importing overwrites what is here, so import first and type after.'),
      ],
    });
  }

  sections.push({
    id: 'guide-saving',
    title: 'It saves itself',
    body: [
      p('There is no save button, and there is nothing you can forget to press. '
        + 'What you type is kept the moment you type it — first on this phone, '
        + 'then on the server a second later. The word at the top tells you '
        + 'which: ', b('Saved'), ' means the server has it.'),
      p(b('It works with no signal.'), ' Keep typing. Close the tab, reopen it, '
        + 'stay offline — what you wrote is still here, and it goes up on its '
        + 'own when the connection comes back. Kitchen-table wifi was the '
        + 'assumption this was built on.'),
      p('The arrow at the top undoes your last change.'),
    ],
  });

  sections.push({
    id: 'guide-computed',
    title: 'The numbers work themselves out',
    body: [
      p('Armour Class, saves, skills, spell DC — you set the parts, and the '
        + 'total is worked out for you. Tap a total and it shows its own '
        + 'arithmetic: which attribute, which proficiency, what the item bonus '
        + 'was, whether your Dexterity was capped by your armour.'),
      p('If a number is wrong, the working shows you which part to fix. And any '
        + 'of them can be overridden outright when your character has something '
        + 'the sheet has not heard of.'),
    ],
  });

  sections.push({
    id: 'guide-gm',
    title: 'What your GM sees',
    body: [
      p('Your GM has a dashboard with the party on it, live. They see your hit '
        + 'points, your AC, your saves, your conditions — the numbers that '
        + 'matter for running a fight.'),
      p('They can push a condition onto this sheet, and it appears here without '
        + 'you doing anything. ', conditions.length
        ? el('span', {}, 'You currently have ', b(String(conditions.length)),
          conditions.length === 1 ? ' condition on this sheet.' : ' conditions on this sheet.')
        : 'You have none on you at the moment.'),
      p(b('They do not see your notes.'), ' The notes boxes are yours.'),
      h3('The screen in the room'),
      p('If your table has one, it shows initiative order and whose turn it is. '
        + 'It shows your hit points as a number, because you know them anyway — '
        + 'the monsters get "Bloodied" instead.'),
    ],
  });

  sections.push({
    id: 'guide-link',
    title: 'Your link',
    body: [
      p('The link you were sent ', b('is'), ' the way in — there is no password '
        + 'and no account. Bookmark it. Anyone who has it can see and edit this '
        + 'character, so treat it like a key rather than a password.'),
      p('It opens this character and nothing else: not the other players’ '
        + 'sheets, not your GM’s dashboard.'),
      p('If it stops working, your GM has rotated it — ask them for the new one. '
        + 'If you think someone else has it, ask them to rotate it, which kills '
        + 'the old one.'),
      p('Playing in two of their games means two links, one per character.'),
    ],
  });

  sections.push({
    id: 'guide-phone',
    title: 'On a phone',
    body: [
      p('This is built for one hand while the other holds dice. Add it to your '
        + 'home screen and it opens like an app.'),
      p('The printer button at the top gives you a clean one-page sheet, which '
        + 'is also how you get a PDF — your print dialogue has ',
      b('Save as PDF'), ' in it. Worth doing before a session you expect to have '
        + 'no signal at.'),
      p('On a keyboard, ', kbd('Ctrl'), ' + ', kbd('Z'), ' undoes.'),
    ],
  });

  const details = el('details', { class: 'card section--wide guide-card' },
    el('summary', { class: 'guide-card__summary' },
      el('h2', { class: 'section__title' }, 'Start here'),
      el('span', { class: 'faint' }, name ? `${name}, and how this works` : 'How this works')),
    // No title and no contents list: the summary above is the title, and a
    // contents list inside a fold you have already opened is furniture.
    guide({ sections, sectionClass: 'guide-card__section', headingTag: 'h3' }));

  if (!seen()) details.open = true;
  details.addEventListener('toggle', () => { if (!details.open) remember(); });

  return details;
}
