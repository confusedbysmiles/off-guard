/**
 * The initiative tracker.
 *
 * The current turn has to be unmistakable from across a table with a laptop at
 * a slight angle, so it gets the gradient, a left bar and a size change rather
 * than a highlight colour alone.
 *
 * A per-combatant eye controls what reaches the shared screen. Creatures start
 * hidden: a fight the players walk into should not be listed before they see it.
 */
import { el, formatMod, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { CONDITIONS, CONDITION_SLUGS, isValued } from '/engine/rules/conditions.js';

const SKILLS = ['perception', 'stealth', 'acrobatics', 'athletics', 'deception', 'intimidation',
  'nature', 'occultism', 'religion', 'society', 'survival'];

export function initiativeView({ combat, encounters, party, actions }) {
  if (!combat) return startPanel({ encounters, actions });

  return el('div', { class: 'panels' },
    el('section', { class: 'panel' },
      el('div', { class: 'panel__head' },
        el('h2', { class: 'panel__title' },
          `Round ${combat.round}`,
          el('span', { class: 'muted' }, combat.name ? ` · ${combat.name}` : '')),
        el('div', { class: 'row-inline row-inline--wrap' },
          el('button', {
            class: 'btn', type: 'button',
            html: `${icon('chevron')}<span>Previous</span>`,
            onclick: () => actions.advance(-1),
          }),
          el('button', {
            class: 'btn btn--primary', type: 'button',
            html: `<span>Next turn</span>${icon('chevron')}`,
            onclick: () => actions.advance(1),
          }),
          el('button', {
            class: 'btn btn--quiet', type: 'button',
            html: `${icon('undo')}<span>Re-sort</span>`,
            title: 'Sort by initiative, descending. Ties keep the order you dragged them into.',
            onclick: () => actions.sortInitiative(),
          }),
          el('button', {
            class: 'btn btn--quiet', type: 'button',
            html: `${icon('x')}<span>End</span>`,
            onclick: () => actions.endCombat(),
          }))),

      el('p', { class: 'faint' },
        'Space or N advances the turn, P steps back. Drag a row to break a tie.'),

      el('ol', { class: 'initiative', id: 'initiative-list' },
        ...combat.combatants.map((combatant, index) => combatantRow({
          combatant, index, active: index === combat.turnIndex, actions, combat,
        })))));
}

function startPanel({ encounters, actions }) {
  let chosenEncounter = '';
  let chosenSkill = 'perception';

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'No fight running')),
    el('p', { class: 'muted' },
      'Starting a fight adds the party and rolls initiative for the creatures. '
      + 'Player initiative is left blank: the players roll their own.'),
    el('div', { class: 'filters stack-md' },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'combat-encounter' }, 'Encounter'),
        el('select', {
          class: 'select', id: 'combat-encounter',
          onchange: (event) => { chosenEncounter = event.target.value; },
        },
        el('option', { value: '' }, 'Party only'),
        ...encounters.map((e) => el('option', { value: String(e.id) }, e.name)))),
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'combat-skill' }, 'Creatures roll'),
        el('select', {
          class: 'select', id: 'combat-skill',
          onchange: (event) => { chosenSkill = event.target.value; },
        },
        ...SKILLS.map((s) => el('option', { value: s }, titleCase(s)))))),
    el('button', {
      class: 'btn btn--primary stack-md', type: 'button',
      html: `${icon('dice')}<span>Roll initiative</span>`,
      onclick: () => actions.startCombat({
        encounterId: chosenEncounter ? Number(chosenEncounter) : null,
        skill: chosenSkill,
      }),
    }));
}

function combatantRow({ combatant, index, active, actions }) {
  const isPlayer = Boolean(combatant.characterId);
  const fraction = combatant.hpMax > 0
    ? Math.max(0, Math.min(1, (combatant.hpCurrent ?? 0) / combatant.hpMax))
    : 0;

  const damageInput = el('input', {
    class: 'input input--compact combatant__damage', type: 'number', inputmode: 'numeric',
    placeholder: '±', 'aria-label': `Damage to ${combatant.displayName}. A negative number heals.`,
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const amount = Number(damageInput.value);
      if (Number.isFinite(amount) && amount !== 0) actions.damage(combatant.id, amount);
      damageInput.value = '';
    },
  });

  return el('li', {
    class: `combatant${active ? ' combatant--active' : ''}${combatant.state !== 'normal' ? ' combatant--waiting' : ''}`,
    draggable: 'true',
    dataset: { combatant: String(combatant.id), index: String(index) },
    'aria-current': active ? 'true' : null,
  },
  el('div', { class: 'combatant__initiative' },
    el('input', {
      class: 'input input--compact', type: 'number', value: combatant.initiative ?? '',
      placeholder: isPlayer ? 'roll' : '',
      'aria-label': `Initiative for ${combatant.displayName}`,
      onchange: (event) => actions.updateCombatant(combatant.id, {
        initiative: event.target.value === '' ? null : Number(event.target.value),
      }),
    })),

  el('div', { class: 'combatant__identity' },
    el('strong', {}, combatant.displayName),
    el('div', { class: 'row-inline row-inline--wrap' },
      isPlayer ? el('span', { class: 'pill' }, 'Player') : null,
      combatant.state !== 'normal' ? el('span', { class: 'pill pill--warn' }, titleCase(combatant.state)) : null,
      combatant.dying ? el('span', { class: 'pill pill--bad' }, `Dying ${combatant.dying}`) : null,
      combatant.wounded ? el('span', { class: 'pill pill--warn' }, `Wounded ${combatant.wounded}`) : null,
      combatant.heroPoints ? el('span', { class: 'pill' }, `${combatant.heroPoints} hero`) : null),
    conditionChips(combatant, actions)),

  el('div', { class: 'combatant__hp' },
    el('div', { class: 'row-inline' },
      el('span', { class: 'tabular' },
        `${combatant.hpCurrent ?? '—'}/${combatant.hpMax ?? '—'}`
        + (combatant.hpTemp ? ` +${combatant.hpTemp}` : '')),
      damageInput),
    el('progress', {
      class: 'hp-bar', value: String(fraction), max: '1',
      'aria-label': `${combatant.displayName} hit points`,
      'aria-valuetext': `${combatant.hpCurrent ?? 0} of ${combatant.hpMax ?? 0}`,
      dataset: { hurt: fraction > 0.5 ? 'none' : (fraction > 0.25 ? 'some' : 'badly') },
    })),

  el('div', { class: 'combatant__tools' },
    conditionPicker(combatant, actions),
    el('button', {
      class: 'btn btn--icon', type: 'button',
      'aria-pressed': String(Boolean(combatant.visible)),
      title: combatant.visible ? 'Visible on the shared screen' : 'Hidden from the shared screen',
      html: `${icon(combatant.visible ? 'eye' : 'cloudOff')}`
        + `<span class="sr-only">${combatant.visible ? 'Hide' : 'Show'} ${combatant.displayName} on the shared screen</span>`,
      onclick: () => actions.updateCombatant(combatant.id, { visible: !combatant.visible }),
    }),
    !isPlayer
      ? el('button', {
        class: 'btn btn--icon', type: 'button',
        'aria-pressed': String(Boolean(combatant.hpNumeric)),
        title: combatant.hpNumeric
          ? 'The table sees this creature’s exact hit points'
          : 'The table sees a descriptor, not a number',
        html: `${icon('heart')}<span class="sr-only">Show exact hit points for ${combatant.displayName}</span>`,
        onclick: () => actions.updateCombatant(combatant.id, { hpNumeric: !combatant.hpNumeric }),
      })
      : null,
    el('select', {
      class: 'select input--compact', 'aria-label': `State for ${combatant.displayName}`,
      onchange: (event) => actions.updateCombatant(combatant.id, { state: event.target.value }),
    },
    ...['normal', 'delayed', 'ready'].map((state) => el('option', {
      value: state, selected: combatant.state === state,
    }, titleCase(state)))),
    el('button', {
      class: 'btn btn--icon btn--quiet', type: 'button',
      html: `${icon('x')}<span class="sr-only">Remove ${combatant.displayName}</span>`,
      onclick: () => actions.removeCombatant(combatant.id),
    })),

  el('input', {
    class: 'input input--compact combatant__note', type: 'text',
    value: combatant.notes ?? '', placeholder: 'Note',
    'aria-label': `Note for ${combatant.displayName}`,
    onchange: (event) => actions.updateCombatant(combatant.id, { notes: event.target.value }),
  }));
}

function conditionChips(combatant, actions) {
  const conditions = combatant.conditions ?? [];
  if (!conditions.length) return null;
  return el('div', { class: 'chips stack-sm' }, ...conditions.map((condition) => el(
    'span', {
      class: 'pill pill--warn',
      title: CONDITIONS[condition.slug]?.text?.slice(0, 200) ?? condition.slug,
    },
    titleCase(condition.slug),
    isValued(condition.slug)
      ? el('input', {
        class: 'input input--compact condition-value', type: 'number', inputmode: 'numeric',
        value: String(condition.value ?? 1),
        'aria-label': `${titleCase(condition.slug)} value on ${combatant.displayName}`,
        onchange: (event) => actions.updateCombatant(combatant.id, {
          conditions: conditions.map((c) => (
            c.slug === condition.slug ? { ...c, value: Number(event.target.value) } : c
          )).filter((c) => !isValued(c.slug) || Number(c.value) > 0),
        }),
      })
      : null,
    el('button', {
      class: 'btn btn--icon btn--quiet', type: 'button',
      html: `${icon('x')}<span class="sr-only">Remove ${titleCase(condition.slug)}</span>`,
      onclick: () => actions.updateCombatant(combatant.id, {
        conditions: conditions.filter((c) => c.slug !== condition.slug),
      }),
    }),
  )));
}

function conditionPicker(combatant, actions) {
  return el('select', {
    class: 'select input--compact', 'aria-label': `Add a condition to ${combatant.displayName}`,
    onchange: (event) => {
      const slug = event.target.value;
      event.target.value = '';
      if (!slug) return;
      const conditions = combatant.conditions ?? [];
      if (conditions.some((c) => c.slug === slug)) return;
      actions.updateCombatant(combatant.id, {
        conditions: [...conditions, { slug, value: isValued(slug) ? 1 : null }],
      });
    },
  },
  el('option', { value: '' }, 'Condition…'),
  ...CONDITION_SLUGS.map((slug) => el('option', { value: slug }, CONDITIONS[slug].name)));
}

/**
 * What the turn boundary asked about.
 *
 * Shown as a list the GM works through, with the sentence each rule comes from,
 * because the whole point is that the tracker did not decide these on its own.
 */
export function promptList(prompts, actions) {
  return el('div', { class: 'prompts' }, ...prompts.map((prompt) => el('div', { class: 'prompt' },
    el('div', {},
      el('strong', {}, `${prompt.name}: ${promptTitle(prompt)}`),
      el('p', { class: 'muted' }, prompt.because)),
    promptActions(prompt, actions))));
}

function promptTitle(prompt) {
  switch (prompt.kind) {
    case 'decrement': return `frightened ${prompt.from} becomes ${prompt.to}`;
    case 'persistent-damage':
      return `${prompt.formula} persistent ${prompt.damageType}, then DC ${prompt.flatCheckDc} flat`;
    case 'stunned': return `stunned ${prompt.value}`;
    case 'recovery-check': return `recovery check, DC ${prompt.dc}`;
    default: return prompt.kind;
  }
}

function promptActions(prompt, actions) {
  if (prompt.kind === 'decrement') {
    return el('span', { class: 'pill pill--good' }, 'Applied');
  }
  if (prompt.kind === 'persistent-damage') {
    const amount = el('input', {
      class: 'input input--compact', type: 'number', inputmode: 'numeric',
      placeholder: prompt.formula, 'aria-label': 'Damage rolled',
    });
    return el('div', { class: 'row-inline' },
      amount,
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const rolled = Number(amount.value);
          if (Number.isFinite(rolled) && rolled > 0) actions.damage(prompt.combatantId, rolled);
        },
      }, 'Apply'));
  }
  return el('span', { class: 'faint' }, 'Your call');
}
