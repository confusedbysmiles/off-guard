/**
 * The encounter builder.
 *
 * Search on the left, the encounter and its budget on the right. The budget is
 * priced by the server on every change, because the level a creature costs
 * against depends on its adjustments and the party comes from the sheets --
 * doing that arithmetic here would be a second implementation of the rules.
 */
import { debounce, el, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { reorderHandle } from '../../lib/reorder.js';

const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
const SIZES = [['tiny', 'Tiny'], ['sm', 'Small'], ['med', 'Medium'], ['lg', 'Large'],
  ['huge', 'Huge'], ['grg', 'Gargantuan']];

/**
 * Display names for the *rows* of an encounter.
 *
 * The division of labour matters here. A row is a line in the encounter, not a
 * creature: a single row with a count of three is still one row. So a row is
 * lettered only when another row holds the same creature -- two separate goblin
 * entries become Goblin Warrior A and Goblin Warrior B, because the GM meant
 * them to be distinguishable.
 *
 * Individual creatures are lettered later, when a fight starts and a row of
 * three becomes three combatants. Doing it in both places is what produced
 * "Goblin A B".
 *
 * A GM who has renamed a row keeps that name.
 */
export function assignDisplayNames(rows, nameOf) {
  const rowsPerCreature = new Map();
  for (const row of rows) {
    const base = nameOf(row.creatureId) ?? row.creatureId;
    rowsPerCreature.set(base, (rowsPerCreature.get(base) ?? 0) + 1);
  }
  const seen = new Map();
  return rows.map((row) => {
    const base = nameOf(row.creatureId) ?? row.creatureId;
    if (row.renamed) return row;
    if ((rowsPerCreature.get(base) ?? 0) <= 1) return { ...row, displayName: base };
    const index = seen.get(base) ?? 0;
    seen.set(base, index + 1);
    return { ...row, displayName: `${base} ${String.fromCharCode(65 + index)}` };
  });
}

export function builderView({
  results, query, encounters, encounter, budget, campaigns, campaignId, catalogue, combat,
  actions, onRun,
}) {
  return el('div', { class: 'panels panels--builder' },
    searchPanel({ results, query, catalogue, actions }),
    el('div', { class: 'panels' },
      encounterPanel({ encounters, encounter, actions, campaigns, campaignId, combat, onRun }),
      budgetPanel(budget)));
}

function searchPanel({ results, query, catalogue, actions }) {
  if (catalogue && catalogue.available === false) {
    return el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'Creatures')),
      el('p', { class: 'empty' },
        'No creature catalogue on this server. Run ',
        el('code', {}, 'npm run build:data'),
        ' and restart.'));
  }

  const onChange = debounce(() => actions.search(readFilters()), 200);
  const form = el('div', { class: 'filters' });

  const text = el('input', {
    class: 'input', type: 'search', id: 'creature-q', value: query.q ?? '',
    placeholder: 'Search creatures…', 'aria-label': 'Search creatures by name',
    oninput: onChange,
  });

  const levelMin = el('input', {
    class: 'input input--compact', type: 'number', value: query.levelMin ?? '',
    'aria-label': 'Minimum level', placeholder: 'Min', oninput: onChange,
  });
  const levelMax = el('input', {
    class: 'input input--compact', type: 'number', value: query.levelMax ?? '',
    'aria-label': 'Maximum level', placeholder: 'Max', oninput: onChange,
  });
  const traits = el('input', {
    class: 'input input--compact', type: 'text', value: (query.traits ?? []).join(','),
    'aria-label': 'Traits, comma separated', placeholder: 'traits', oninput: onChange,
  });
  const rarity = select('Rarity', RARITIES.map((r) => [r, titleCase(r)]), query.rarity, onChange);
  const size = select('Size', SIZES, query.size, onChange);
  const source = select('Source', (catalogue?.sources ?? []).map((s) => [s.book, s.book]),
    query.source, onChange);

  const readFilters = () => ({
    q: text.value,
    levelMin: levelMin.value === '' ? null : Number(levelMin.value),
    levelMax: levelMax.value === '' ? null : Number(levelMax.value),
    traits: traits.value.split(',').map((t) => t.trim()).filter(Boolean),
    rarity: rarity.value || null,
    size: size.value || null,
    source: source.value || null,
  });

  form.append(
    text,
    el('div', { class: 'filters__row' }, levelMin, levelMax, traits),
    el('div', { class: 'filters__row' }, rarity, size, source),
  );

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Creatures'),
      el('span', { class: 'muted' },
        results ? `${results.total} match${results.total === 1 ? '' : 'es'}` : '')),
    form,
    results && results.rows.length
      ? el('div', { class: 'results' }, ...results.rows.map((row) => resultRow(row, actions)))
      : el('p', { class: 'empty' }, results ? 'Nothing matches those filters.' : 'Searching…'));
}

function select(label, options, value, onChange) {
  return el('select', {
    class: 'select input--compact', 'aria-label': label, onchange: onChange,
  },
  el('option', { value: '' }, label),
  ...options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
}

function resultRow(row, actions) {
  return el('div', { class: 'result' },
    el('span', {
      class: 'result__level',
      title: `Level ${row.level}`,
    }, String(row.level)),
    el('div', { class: 'result__name' },
      el('strong', {}, row.name),
      el('div', { class: 'result__traits' },
        row.rarity !== 'common'
          ? el('span', { class: 'result__trait', dataset: { rarity: row.rarity } }, titleCase(row.rarity))
          : null,
        ...(row.traits ?? []).slice(0, 5).map((t) => el('span', { class: 'result__trait' }, t)),
        el('span', { class: 'faint' }, row.book ?? ''))),
    el('div', { class: 'result__actions' },
      el('button', {
        class: 'btn btn--icon', type: 'button', title: `Preview ${row.name}`,
        html: `${icon('eye')}<span class="sr-only">Preview ${row.name}</span>`,
        onclick: () => actions.preview(row.id),
      }),
      el('button', {
        class: 'btn btn--primary', type: 'button',
        html: `${icon('plus')}<span>Add</span>`,
        onclick: (event) => actions.add(row.id, event.shiftKey ? 4 : 1),
        title: 'Add to the encounter. Hold Shift to add four.',
      })));
}

/**
 * The encounters in this campaign, in the order they are planned to run.
 *
 * A list rather than the dropdown this used to be, for two reasons: the order
 * is the session plan and a dropdown hides all of it but one line, and an
 * `<option>` cannot be dragged, so the reorder endpoint had nothing to attach
 * to.
 */
function encounterList({ encounters, encounter, actions }) {
  if (!encounters.length) return null;
  return el('ol', { class: 'encounter-list', id: 'encounter-list' },
    ...encounters.map((e) => el('li', {
      class: 'encounter-item',
      draggable: 'true',
      dataset: { encounter: String(e.id) },
    },
    reorderHandle(el, icon, e.name),
    el('button', {
      class: 'encounter-item__open', type: 'button',
      'aria-current': encounter?.id === e.id ? 'true' : null,
      onclick: () => actions.openEncounter(e.id),
    }, e.name))));
}

function encounterPanel({
  encounters, encounter, actions, campaigns, campaignId, combat, onRun,
}) {
  const picker = encounterList({ encounters, encounter, actions });

  if (!encounter) {
    return el('section', { class: 'panel' },
      el('div', { class: 'panel__head' },
        el('h2', { class: 'panel__title' }, 'Encounter'),
        el('button', {
          class: 'btn', type: 'button',
          html: `${icon('plus')}<span>New</span>`,
          onclick: () => actions.newEncounter(),
        })),
      picker,
      el('p', { class: 'empty stack-md' }, 'Pick an encounter, or start a new one.'));
  }

  const rows = encounter.creatures ?? [];

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Encounter'),
      el('div', { class: 'row-inline row-inline--wrap' },
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('plus')}<span>New</span>`,
          onclick: () => actions.newEncounter(),
        }),
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('upload')}<span>Export</span>`,
          onclick: () => actions.exportEncounter(),
        }),
        copyMenu({ campaigns, campaignId, actions }),
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('x')}<span>Delete</span>`,
          onclick: () => actions.deleteEncounter(),
        }))),

    picker,

    el('input', {
      class: 'input stack-md', type: 'text', value: encounter.name,
      'aria-label': 'Encounter name',
      onchange: (event) => actions.renameEncounter(event.target.value),
    }),

    rows.length
      ? el('div', { class: 'encounter-rows stack-md', id: 'encounter-rows' },
        ...rows.map((row, index) => encounterRow(row, index, actions)))
      : el('p', { class: 'empty stack-md' }, 'Nothing in this encounter yet.'),

    // The whole point of having built this. Without it the only way to run an
    // encounter was a dropdown on another tab that defaults to "Party only",
    // which is a thing you have to already know.
    rows.length
      ? el('div', { class: 'encounter-run stack-md' },
        el('button', {
          class: 'btn btn--primary', type: 'button', id: 'run-encounter',
          html: `${icon('dice')}<span>Roll initiative</span>`,
          onclick: () => actions.startCombat({ encounterId: encounter.id, onStarted: onRun }),
        }),
        el('span', { class: 'faint' }, combat
          ? 'Ends the fight already running and starts this one.'
          : 'Adds the party, rolls for the creatures, and opens the Initiative tab.'))
      : null,

    el('details', { class: 'stack-md' },
      el('summary', {}, 'Notes, terrain and treasure'),
      ...['notes', 'terrain', 'lighting', 'treasure'].map((field) => el('div', { class: 'field stack-sm' },
        el('label', { class: 'field__label', for: `enc-${field}` }, titleCase(field)),
        el('textarea', {
          class: 'textarea', id: `enc-${field}`, rows: 2,
          onchange: (event) => actions.updateEncounter({ [field]: event.target.value }),
        }, encounter[field] ?? '')))));
}

function copyMenu({ campaigns, campaignId, actions }) {
  const others = campaigns.filter((c) => c.id !== campaignId && !c.archivedAt);
  if (!others.length) return null;
  return el('select', {
    class: 'select input--compact', 'aria-label': 'Copy this encounter to another campaign',
    onchange: (event) => {
      const target = Number(event.target.value);
      event.target.value = '';
      if (target) actions.copyEncounter(target);
    },
  },
  el('option', { value: '' }, 'Copy to…'),
  ...others.map((c) => el('option', { value: String(c.id) }, c.name)));
}

function encounterRow(row, index, actions) {
  const scale = Number(row.levelScale ?? 0);

  return el('div', {
    class: 'encounter-row',
    draggable: 'true',
    // The index is the identity here: these rows have no id of their own until
    // they are saved, and the order is what is being edited.
    dataset: { row: String(index) },
  },
  reorderHandle(el, icon, row.displayName || 'this entry'),
  el('div', {},
      el('input', {
        class: 'input input--compact', type: 'text', value: row.displayName ?? '',
        'aria-label': `Display name for entry ${index + 1}`,
        onchange: (event) => actions.updateRow(index, { displayName: event.target.value, renamed: true }),
      }),
      el('div', { class: 'encounter-row__controls stack-sm' },
        el('button', {
          class: 'btn btn--icon scale-step', type: 'button',
          html: `<span aria-hidden="true">−</span><span class="sr-only">Lower the level of ${row.displayName}</span>`,
          disabled: scale <= -4,
          onclick: () => actions.updateRow(index, { levelScale: scale - 1 }),
        }),
        el('span', { class: 'pill tabular', title: 'Level adjustment. An approximation, not elite or weak.' },
          scale === 0 ? 'level' : `${scale > 0 ? '+' : ''}${scale}`),
        el('button', {
          class: 'btn btn--icon scale-step', type: 'button',
          html: `<span aria-hidden="true">+</span><span class="sr-only">Raise the level of ${row.displayName}</span>`,
          disabled: scale >= 4,
          onclick: () => actions.updateRow(index, { levelScale: scale + 1 }),
        }),
        el('button', {
          class: 'btn', type: 'button', 'aria-pressed': String(row.adjustment === 'elite'),
          onclick: () => actions.updateRow(index, {
            adjustment: row.adjustment === 'elite' ? null : 'elite',
          }),
        }, 'Elite'),
        el('button', {
          class: 'btn', type: 'button', 'aria-pressed': String(row.adjustment === 'weak'),
          onclick: () => actions.updateRow(index, {
            adjustment: row.adjustment === 'weak' ? null : 'weak',
          }),
        }, 'Weak'))),

    el('div', { class: 'row-inline' },
      el('input', {
        class: 'input input--compact', type: 'number', min: '1', value: String(row.count ?? 1),
        'aria-label': `How many ${row.displayName}`,
        onchange: (event) => actions.updateRow(index, { count: Math.max(1, Number(event.target.value)) }),
      }),
      el('button', {
        class: 'btn btn--icon', type: 'button', title: 'Preview stat block',
        html: `${icon('eye')}<span class="sr-only">Preview ${row.displayName}</span>`,
        onclick: () => actions.preview(row.creatureId, { scale, adjustment: row.adjustment }),
      }),
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        html: `${icon('x')}<span class="sr-only">Remove ${row.displayName}</span>`,
        onclick: () => actions.removeRow(index),
      })));
}

function budgetPanel(budget) {
  if (!budget) {
    return el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'Budget')),
      el('p', { class: 'empty' }, 'Add a creature to see the budget.'));
  }

  const max = Math.max(budget.totalXp, ...budget.budgets.map((b) => b.xp)) || 1;

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Budget'),
      el('span', { class: 'muted' },
        `${budget.partySize ?? budget.party?.size} characters, level ${budget.partyLevel}`)),

    el('div', { class: 'budget' },
      el('div', { class: 'budget__total' },
        el('span', { class: 'budget__xp' }, String(budget.totalXp)),
        el('span', { class: 'muted' }, 'XP'),
        budget.difficulty
          ? el('span', { class: 'budget__band', dataset: { band: budget.difficulty } },
            budget.difficulty === 'beyond-extreme' ? 'Beyond extreme' : titleCase(budget.difficulty))
          : null),

      // An incomplete total is not a total, and must not be shown as one.
      !budget.complete
        ? el('div', { class: 'notice' },
          el('div', { class: 'notice__body' },
            el('strong', {}, 'No difficulty for this encounter.'),
            ...budget.offTable.map((entry) => el('p', { class: 'muted' },
              `${entry.name}: ${entry.reason}.`)),
            el('p', { class: 'faint' },
              'The encounter table runs from four levels below the party to four '
              + 'above. Outside that the rules give no number, so neither does this.')))
        : null,

      budget.missing?.length
        ? el('p', { class: 'pill pill--bad' },
          `${budget.missing.length} creature${budget.missing.length === 1 ? '' : 's'} `
          + 'not in the catalogue and not counted.')
        : null,

      el('div', { class: 'budget__scale' }, ...budget.budgets.map((band) => {
        const reached = budget.totalXp >= band.xp;
        // A <progress> rather than a div with a width: a percentage cannot be
        // expressed in CSS from a data attribute, and an inline style is
        // forbidden by the Content-Security-Policy. It is also what this is.
        return el('div', { class: 'budget__mark', dataset: { reached: String(reached) } },
          el('span', { class: 'muted' }, titleCase(band.difficulty)),
          el('progress', {
            class: 'budget__track',
            value: String(Math.min(budget.totalXp, band.xp)),
            max: String(band.xp),
            'aria-label': `${titleCase(band.difficulty)} budget`,
            'aria-valuetext': `${budget.totalXp} of ${band.xp} XP`,
          }),
          el('span', { class: 'tabular faint' }, String(band.xp)));
      }))),

    budget.party?.levelDisagrees
      ? el('p', { class: 'faint stack-sm' },
        'Party level is taken from the sheets, not the campaign field.')
      : null);
}
