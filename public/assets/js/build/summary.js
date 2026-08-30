/**
 * The live summary.
 *
 * What the character currently is, beside what they are still choosing. Every
 * number here came from the server's derivation -- the browser does no
 * arithmetic on a character, deliberately -- so this panel and the player's
 * sheet cannot disagree.
 *
 * Problems are listed rather than enforced. A half-built character is the
 * normal state of one being built, and a builder that refuses to save until
 * everything is answered is a builder you cannot put down mid-thought.
 */
import { el, formatMod, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const SAVES = [['fortitude', 'Fort'], ['reflex', 'Ref'], ['will', 'Will']];
const ATTRIBUTES = [
  ['str', 'Str'], ['dex', 'Dex'], ['con', 'Con'],
  ['int', 'Int'], ['wis', 'Wis'], ['cha', 'Cha'],
];

export function renderSummary(host, { state }) {
  const { derived } = state;
  if (!derived) { host.replaceChildren(); return; }

  const sheet = derived.sheet ?? {};
  const prof = derived.proficiencies ?? {};

  // `replaceChildren` renders a null child as the text "null"; `el` filters
  // them but this is a direct call, so the list is filtered here.
  host.replaceChildren(...[
    el('div', { class: 'summary__identity' },
      el('h2', { class: 'summary__name' }, sheet.name || 'Unnamed character'),
      el('p', { class: 'muted' }, [
        sheet.heritage, sheet.ancestry, sheet.background, sheet.class,
      ].filter(Boolean).join(' · ') || 'Nothing chosen yet')),

    el('dl', { class: 'summary__stats' },
      stat('Hit points', sheet.hp?.max ?? '—'),
      stat('Speed', sheet.speed ? `${sheet.speed} ft.` : '—'),
      stat('Perception', titleCase(prof.perception ?? 'untrained')),
      stat('Class DC', titleCase(prof.classDc ?? 'untrained'))),

    el('h3', { class: 'section__title' }, 'Attributes'),
    el('div', { class: 'summary__attributes' }, ...ATTRIBUTES.map(([key, short]) => {
      const exact = derived.attributes?.exact?.[key];
      const mod = sheet.abilities?.[key] ?? 0;
      // A modifier sitting on a half point is worth saying out loud: the next
      // boost is what completes it, and until then it looks like nothing
      // happened.
      const partial = typeof exact === 'number' && exact !== Math.trunc(exact);
      return el('div', { class: 'summary__attribute' },
        el('span', { class: 'summary__attribute-name' }, short),
        el('span', { class: 'summary__attribute-mod' }, formatMod(mod)),
        partial ? el('span', { class: 'summary__attribute-half', title: `Exactly ${exact}` }, '½') : null);
    })),

    el('h3', { class: 'section__title' }, 'Saves'),
    el('div', { class: 'summary__saves' }, ...SAVES.map(([key, short]) => el('div', { class: 'summary__save' },
      el('span', {}, short),
      el('strong', {}, titleCase(sheet.saves?.[key]?.rank ?? 'untrained'))))),

    problemList(derived),
    missingList(derived),
  ].filter(Boolean));
}

const stat = (label, value) => el('div', { class: 'summary__stat' },
  el('dt', {}, label), el('dd', {}, String(value)));

/**
 * What is still to decide.
 *
 * Two kinds of thing, and both belong in one list. The rules engine reports
 * *problems* -- boosts uncounted, a skill trained twice -- and the timeline has
 * *empty slots*, which are not problems but are equally unfinished. Listing
 * only the first is how the header came to say "10 still to choose" beside a
 * panel saying there was nothing left.
 *
 * Only at or below the current level: a level 9 feat nobody has picked yet is a
 * plan, not an omission.
 */
function problemList(derived) {
  const problems = derived.problems ?? [];
  const empty = (derived.slots ?? []).filter((slot) => slot.empty && slot.level <= derived.level);
  const total = problems.length + empty.length;

  if (!total) {
    return el('p', { class: 'summary__done' },
      el('span', { class: 'level__tick', html: icon('check') }),
      'Nothing left to choose at this level.');
  }

  return el('div', { class: 'stack-sm' },
    el('h3', { class: 'section__title' }, `Still to decide (${total})`),
    el('ul', { class: 'summary__problems' },
      ...problems.map((problem) => el('li', {},
        el('span', { class: 'summary__problem-where' }, titleCase(problem.section ?? '')),
        problem.message)),
      ...empty.map((slot) => el('li', {},
        el('span', { class: 'summary__problem-where' }, `Level ${slot.level}`),
        `${slot.label} — not yet chosen`))));
}

/** A build naming an option the catalogue no longer has, said plainly. */
function missingList(derived) {
  const missing = derived.missing ?? [];
  if (!missing.length) return null;
  return el('div', { class: 'notice notice--warn' },
    el('div', { class: 'notice__body' },
      el('strong', {}, 'Some choices could not be found'),
      el('ul', {}, ...missing.map((entry) => el('li', {}, entry.message)))));
}
