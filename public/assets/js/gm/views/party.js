/**
 * The party panel.
 *
 * Live from the sheets: every number here was computed by the rules engine from
 * what the player last typed, so the panel and the sheet cannot disagree.
 */
import { displayName } from '../../../../engine/shared/character-name.js';
import { el, formatMod, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';

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

/**
 * One number, and what it was before anything was put on this character.
 *
 * Marked rather than only recoloured, and the old value is in the title: a
 * GM reading AC off this panel to set a DC needs to know the 18 is a frightened
 * 22 rather than a sheet nobody has updated.
 */
const stat = (label, value, before = undefined) => el('div', {
  class: `pc__stat${before === undefined ? '' : ' pc__stat--affected'}`,
  ...(before === undefined ? {} : { title: `${before} before effects` }),
},
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

function characterRow(character, { actions }) {
  const was = character.effects?.before ?? {};
  const hpFraction = character.hp.max > 0
    ? Math.max(0, Math.min(1, character.hp.current / character.hp.max))
    : 0;

  return el('article', { class: `pc${character.flags.length ? ' pc--flagged' : ''}` },
    el('div', { class: 'pc__name' },
      el('strong', {}, displayName(character)),
      el('span', { class: 'pc__player' },
        [character.playerName, character.class, `Level ${character.level}`]
          .filter(Boolean).join(' · '))),

    stat('AC', character.ac, was.ac),
    stat('Perc', formatMod(character.perception), was.perception && formatMod(was.perception)),
    stat('Fort', formatMod(character.saves.fortitude), was['saves.fortitude'] && formatMod(was['saves.fortitude'])),
    stat('Ref', formatMod(character.saves.reflex), was['saves.reflex'] && formatMod(was['saves.reflex'])),
    stat('Will', formatMod(character.saves.will), was['saves.will'] && formatMod(was['saves.will'])),

    el('div', { class: 'pc__hp' },
      el('div', { class: 'row-inline row-inline--wrap' },
        el('span', { class: 'tabular' },
          `${character.hp.current}/${character.hp.max}`
          + (character.hp.temp ? ` +${character.hp.temp}` : '')),
        character.heroPoints ? el('span', { class: 'pill' }, `${character.heroPoints} hero`) : null),
      el('progress', {
        class: 'hp-bar', value: String(hpFraction), max: '1',
        'aria-label': `${displayName(character)} hit points`,
        'aria-valuetext': `${character.hp.current} of ${character.hp.max}`,
        dataset: { hurt: hpFraction > 0.5 ? 'none' : (hpFraction > 0.25 ? 'some' : 'badly') },
      }),
      character.conditions.length
        ? el('div', { class: 'pc__flags stack-sm' }, ...character.conditions.map((c) => el(
          'span', { class: 'pill pill--warn' },
          `${titleCase(c.slug)}${c.value ? ` ${c.value}` : ''}`,
        )))
        : null,
      /**
       * What is running on them, each one removable from here.
       *
       * An effect the player turned off is still listed, greyed: the GM
       * pushing a second Bless onto somebody who already has one switched off
       * is the confusion this avoids.
       */
      character.effects?.own?.length
        ? el('div', { class: 'pc__flags stack-sm' }, ...character.effects.own.map((effect) => el(
          'span',
          { class: `pill pill--accent${effect?.active === false ? ' pill--off' : ''}` },
          effect?.name || 'Effect',
          el('button', {
            class: 'pill__remove', type: 'button',
            title: `Remove ${effect?.name || 'this effect'} from ${displayName(character)}`,
            html: `${icon('x')}<span class="sr-only">Remove</span>`,
            onclick: () => actions.clearEffect(character, effect?.id),
          }),
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

export function partyPanel(party, { actions, onPush = () => {} } = {}) {
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
        `${party.size} character${party.size === 1 ? '' : 's'}, level ${party.effectiveLevel}`),
      el('button', {
        class: 'btn', type: 'button',
        html: `${icon('plus')}<span>Push an effect</span>`,
        onclick: () => onPush(party.characters),
      })),

    party.levelDisagrees
      ? el('p', { class: 'pill pill--warn' },
        `The campaign says level ${party.campaign.partyLevel}; the sheets say `
        + `${party.effectiveLevel}. Encounter maths uses the sheets.`)
      : null,

    el('div', { class: 'party' },
      ...party.characters.map((character) => characterRow(character, { actions }))),

    anyFlags
      ? el('p', { class: 'faint stack-sm' },
        'A flagged sheet is one nobody has touched in three weeks, one whose '
        + 'level trails the party, or one with no hit points recorded.')
      : null);
}
