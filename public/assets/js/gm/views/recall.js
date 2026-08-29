/**
 * The Recall Knowledge helper.
 *
 * Which skills apply and what the DC is are rules, and come from the engine.
 * What a success actually tells the player is not: the printed guidance is
 * "a well-known attribute, and something more subtle on a critical success",
 * with no table of which number comes out on which degree. So this lists the
 * creature's facts in a sensible order and lets the GM decide, and says on
 * screen that the order is the application's convenience rather than a rule.
 *
 * Revealing a fact pushes it to the shared screen, which is the whole point:
 * the player who made the check should not have to write the number down while
 * five other people are talking.
 */
import { el, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';

const DEGREE_ORDER = ['critical success', 'success', 'failure', 'critical failure'];

export function recallTab({ recall, onReveal, onRevealAll, onDifficulty, subject }) {
  if (!recall) {
    return el('div', { class: 'empty' },
      el('p', {}, 'Nothing selected.'),
      el('p', { class: 'faint' },
        'Choose a creature from the initiative tracker, or press K on the row whose '
        + 'turn it is.'));
  }

  const revealedCount = recall.facts.filter((f) => f.revealed).length;

  return el('div', { class: 'recall' },
    el('header', { class: 'recall__head' },
      el('h3', {}, recall.creature.name),
      el('span', { class: 'faint' },
        `Level ${recall.creature.level}`
        + (recall.creature.rarity && recall.creature.rarity !== 'common'
          ? ` · ${titleCase(recall.creature.rarity)}`
          : ''))),

    subject ? el('p', { class: 'faint' }, subject) : null,

    el('section', { class: 'recall__dc' },
      el('strong', { class: 'recall__dc-value' }, `DC ${recall.dc.dc}`),
      el('span', { class: 'faint' },
        `${recall.dc.base} by level`
        + (recall.dc.rarityAdjustment ? ` · +${recall.dc.rarityAdjustment} ${recall.dc.rarity}` : '')
        + (recall.dc.difficultyAdjustment
          ? ` · ${recall.dc.difficultyAdjustment > 0 ? '+' : ''}${recall.dc.difficultyAdjustment} adjustment`
          : '')),
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'recall-difficulty' }, 'Adjustment'),
        el('select', {
          class: 'select input--compact', id: 'recall-difficulty',
          onchange: (event) => onDifficulty(event.target.value || null),
        },
        el('option', { value: '' }, 'None'),
        ...['incredibly easy', 'very easy', 'easy', 'hard', 'very hard', 'incredibly hard']
          .map((d) => el('option', { value: d }, titleCase(d)))))),

    el('section', { class: 'recall__skills' },
      el('h4', {}, 'Skills that identify it'),
      el('div', { class: 'chips' }, ...recall.skills.map((entry) => el('span', {
        class: 'pill',
        title: entry.viaTraits?.length
          ? `From the ${entry.viaTraits.join(', ')} trait${entry.viaTraits.length > 1 ? 's' : ''}`
          : (entry.note ?? ''),
      }, titleCase(entry.skill))))),

    el('section', { class: 'recall__degrees' },
      ...DEGREE_ORDER.map((degree) => el('p', { class: 'recall__degree' },
        el('strong', {}, titleCase(degree)),
        ' ',
        recall.degrees[degree]))),

    el('section', { class: 'recall__facts' },
      el('div', { class: 'panel__head' },
        el('h4', {}, `Facts (${revealedCount} shown to the table)`),
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          onclick: () => onRevealAll(false),
          disabled: revealedCount === 0,
          html: `${icon('cloudOff')}<span>Hide all</span>`,
        })),
      recall.factOrderIsAdvisory
        ? el('p', { class: 'faint' },
          'Ordered obvious first. That order is this application’s convenience, '
          + 'not a printed rule -- what a success reveals is the GM’s call.')
        : null,
      el('ul', { class: 'facts' }, ...recall.facts.map((fact) => el('li', {
        class: `fact${fact.revealed ? ' fact--revealed' : ''}`,
      },
      el('div', { class: 'fact__body' },
        el('strong', {}, fact.label),
        el('span', {}, fact.value)),
      el('button', {
        class: 'btn btn--icon', type: 'button',
        'aria-pressed': String(fact.revealed),
        title: fact.revealed ? 'Shown on the shared screen' : 'Show on the shared screen',
        html: `${icon(fact.revealed ? 'eye' : 'cloudOff')}`
          + `<span class="sr-only">${fact.revealed ? 'Hide' : 'Reveal'} ${fact.label}</span>`,
        onclick: () => onReveal(fact, !fact.revealed),
      }))))),

    el('p', { class: 'faint' }, recall.additionalSuccesses));
}
