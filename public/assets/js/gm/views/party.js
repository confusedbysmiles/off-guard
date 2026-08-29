/**
 * The party panel.
 *
 * Live from the sheets: every number here was computed by the rules engine from
 * what the player last typed, so the panel and the sheet cannot disagree.
 */
import { el, formatMod, titleCase } from '../../lib/dom.js';

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

const SHORT = {
  acrobatics: 'Acro', arcana: 'Arca', athletics: 'Athl', crafting: 'Craf',
  deception: 'Dece', diplomacy: 'Dipl', intimidation: 'Inti', medicine: 'Medi',
  nature: 'Natu', occultism: 'Occu', performance: 'Perf', religion: 'Reli',
  society: 'Soci', stealth: 'Stea', survival: 'Surv', thievery: 'Thie',
};

const stat = (label, value) => el('div', { class: 'pc__stat' },
  el('span', {}, label),
  el('strong', {}, String(value)));

function skillGrid(skills) {
  return el('div', { class: 'skill-grid' }, ...SKILLS.map((skill) => el(
    'span', {
      class: 'skill-grid__cell',
      title: titleCase(skill),
      // An untrained skill is still shown: a GM asking "can anyone track this"
      // needs to see the zero, not an absence.
      dataset: { untrained: String(skills[skill] === 0) },
    },
    el('span', {}, SHORT[skill]),
    el('span', {}, formatMod(skills[skill])),
  )));
}

function characterRow(character) {
  const hpFraction = character.hp.max > 0
    ? Math.max(0, Math.min(1, character.hp.current / character.hp.max))
    : 0;

  return el('article', { class: `pc${character.flags.length ? ' pc--flagged' : ''}` },
    el('div', { class: 'pc__name' },
      el('strong', {}, character.name),
      el('span', { class: 'pc__player' },
        [character.playerName, character.class, `Level ${character.level}`]
          .filter(Boolean).join(' · '))),

    stat('AC', character.ac),
    stat('Perc', formatMod(character.perception)),
    stat('Fort', formatMod(character.saves.fortitude)),
    stat('Ref', formatMod(character.saves.reflex)),
    stat('Will', formatMod(character.saves.will)),

    el('div', { class: 'pc__hp' },
      el('div', { class: 'row-inline row-inline--wrap' },
        el('span', { class: 'tabular' },
          `${character.hp.current}/${character.hp.max}`
          + (character.hp.temp ? ` +${character.hp.temp}` : '')),
        character.heroPoints ? el('span', { class: 'pill' }, `${character.heroPoints} hero`) : null),
      el('progress', {
        class: 'hp-bar', value: String(hpFraction), max: '1',
        'aria-label': `${character.name} hit points`,
        'aria-valuetext': `${character.hp.current} of ${character.hp.max}`,
        dataset: { hurt: hpFraction > 0.5 ? 'none' : (hpFraction > 0.25 ? 'some' : 'badly') },
      }),
      character.conditions.length
        ? el('div', { class: 'pc__flags stack-sm' }, ...character.conditions.map((c) => el(
          'span', { class: 'pill pill--warn' },
          `${titleCase(c.slug)}${c.value ? ` ${c.value}` : ''}`,
        )))
        : null,
      character.flags.length
        ? el('div', { class: 'pc__flags stack-sm' }, ...character.flags.map((flag) => el(
          'span', { class: 'pill pill--warn', title: flag.detail },
          { stale: 'Stale', behind: 'Behind', empty: 'No HP' }[flag.kind] ?? flag.kind,
        )))
        : null,
      skillGrid(character.skills)));
}

export function partyPanel(party) {
  if (!party || !party.characters.length) {
    return el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'Party')),
      el('p', { class: 'empty' }, 'No characters in this campaign yet.'));
  }

  const anyFlags = party.characters.some((c) => c.flags.length);

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Party'),
      el('span', { class: 'muted' },
        `${party.size} character${party.size === 1 ? '' : 's'}, level ${party.effectiveLevel}`)),

    party.levelDisagrees
      ? el('p', { class: 'pill pill--warn' },
        `The campaign says level ${party.campaign.partyLevel}; the sheets say `
        + `${party.effectiveLevel}. Encounter maths uses the sheets.`)
      : null,

    el('div', { class: 'party' }, ...party.characters.map(characterRow)),

    anyFlags
      ? el('p', { class: 'faint stack-sm' },
        'A flagged sheet is one nobody has touched in three weeks, one whose '
        + 'level trails the party, or one with no hit points recorded.')
      : null);
}
