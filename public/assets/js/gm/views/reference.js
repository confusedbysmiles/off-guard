/**
 * The reference drawer.
 *
 * Everything a GM looks up mid-sentence: level DCs, skill actions, treasure by
 * level, Earn Income, and the full text of every condition. One search field
 * over all of it, because at the table you know the word you want, not which
 * table it lives in.
 *
 * Conditions do not come from the reference corpus. They come from the rules
 * engine's own condition table -- the same one the initiative tracker applies
 * -- so the text a GM reads out and the text the tracker acts on cannot drift
 * apart. Everything else comes from `data/reference.json`.
 */
import { el, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { CONDITIONS, CONDITION_SLUGS } from '/engine/rules/conditions.js';
import { DC_BY_LEVEL, dcByLevel, SIMPLE_DC } from '/engine/rules/dc.js';

/** Conditions, in the same shape a corpus entry has, so search is uniform. */
function conditionEntries() {
  return CONDITION_SLUGS.map((slug) => {
    const condition = CONDITIONS[slug];
    return {
      id: `condition/${slug}`,
      kind: 'condition',
      slug,
      name: condition.name,
      group: 'conditions',
      html: condition.html,
      text: condition.text,
      citation: null,
      valued: condition.valued,
      overrides: condition.overrides,
      source: { title: condition.source, license: condition.license, page: null },
    };
  });
}

/**
 * The whole searchable set: conditions first, then the corpus.
 *
 * Built once per reference load and cached on the payload, because it is
 * rebuilt on every keystroke otherwise and it never changes.
 */
export function indexReference(reference) {
  const entries = [...conditionEntries(), ...(reference?.entries ?? [])];
  const groups = [
    { id: 'conditions', label: 'Conditions', kind: 'condition' },
    ...(reference?.groups ?? []),
  ];
  return {
    available: reference?.available !== false,
    groups,
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    // Lower-cased once, so searching is a substring test rather than a
    // toLowerCase over a third of a megabyte per keystroke.
    haystack: entries.map((e) => ({
      id: e.id,
      name: e.name.toLowerCase(),
      text: e.text.toLowerCase(),
    })),
  };
}

/**
 * Rank matches so the thing you typed the name of comes first.
 *
 * A GM typing "demo" wants Demoralize, not the eleven entries whose body text
 * mentions demoralizing.
 */
export function searchReference(index, query, { limit = 40 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const row of index.haystack) {
    let score = null;
    if (row.name === q) score = 0;
    else if (row.name.startsWith(q)) score = 1;
    else if (row.name.includes(q)) score = 2;
    else if (row.text.includes(q)) score = 3;
    if (score !== null) scored.push({ id: row.id, score, name: row.name });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ id }) => index.byId.get(id));
}

/** `2 actions`, `reaction`, `free action`, or nothing for a passive entry. */
function costLabel(cost) {
  if (!cost) return null;
  if (cost.type === 'reaction') return 'Reaction';
  if (cost.type === 'free') return 'Free action';
  if (cost.type === 'passive') return null;
  if (cost.count === null || cost.count === undefined) return 'Variable actions';
  return cost.count === 1 ? '1 action' : `${cost.count} actions`;
}

function entryRow(entry, { onOpen, current }) {
  return el('button', {
    class: 'ref-row', type: 'button',
    'aria-current': entry.id === current ? 'true' : null,
    onclick: () => onOpen(entry.id),
  },
  el('span', { class: 'ref-row__name' }, entry.name),
  el('span', { class: 'ref-row__meta' },
    [costLabel(entry.cost), entry.kind === 'table' ? 'Table' : null,
      entry.kind === 'condition' ? 'Condition' : null].filter(Boolean).join(' · ')));
}

/** The body of an entry. The HTML was sanitized when the corpus was built. */
function entryBody(entry) {
  const body = el('div', { class: 'ref-body' });
  body.innerHTML = entry.html;
  return body;
}

function entryPanel(entry) {
  if (!entry) return null;
  const traits = entry.traits ?? [];
  return el('article', { class: 'ref-entry' },
    el('header', { class: 'ref-entry__head' },
      el('h3', {}, entry.name),
      costLabel(entry.cost) ? el('span', { class: 'pill' }, costLabel(entry.cost)) : null),
    traits.length
      ? el('div', { class: 'ref-entry__traits' },
        ...traits.map((t) => el('span', { class: 'result__trait' }, titleCase(t))))
      : null,
    entry.kind === 'condition' && entry.valued
      ? el('p', { class: 'faint' }, 'This condition has a value.')
      : null,
    entry.kind === 'condition' && entry.overrides?.length
      ? el('p', { class: 'faint' },
        `Overrides ${entry.overrides.map(titleCase).join(', ')}.`)
      : null,
    entryBody(entry),
    el('p', { class: 'faint ref-entry__source' },
      [entry.citation, entry.source?.title, entry.source?.license]
        .filter(Boolean).join(' · ')));
}

/**
 * The level DC calculator.
 *
 * Pinned to the top of the drawer rather than buried in the DCs table, because
 * "what's the DC for a level 7 thing, and it's rare" is the single most common
 * question a GM asks a reference, and reading it off a table means finding the
 * row and then remembering the rarity adjustment.
 */
function dcCalculator({ level, rarity, difficulty, onChange }) {
  const result = dcByLevel(level, { rarity, difficulty });
  const levels = Object.keys(DC_BY_LEVEL).map(Number).sort((a, b) => a - b);

  return el('section', { class: 'ref-dc' },
    el('div', { class: 'ref-dc__controls' },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'ref-dc-level' }, 'Level'),
        el('select', {
          class: 'select', id: 'ref-dc-level',
          onchange: (e) => onChange({ level: Number(e.target.value) }),
        }, ...levels.map((l) => el('option', {
          value: String(l), selected: l === level,
        }, String(l))))),
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'ref-dc-rarity' }, 'Rarity'),
        el('select', {
          class: 'select', id: 'ref-dc-rarity',
          onchange: (e) => onChange({ rarity: e.target.value }),
        }, ...['common', 'uncommon', 'rare', 'unique'].map((r) => el('option', {
          value: r, selected: r === rarity,
        }, titleCase(r))))),
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'ref-dc-difficulty' }, 'Adjustment'),
        el('select', {
          class: 'select', id: 'ref-dc-difficulty',
          onchange: (e) => onChange({ difficulty: e.target.value || null }),
        },
        el('option', { value: '' }, 'None'),
        ...['incredibly easy', 'very easy', 'easy', 'hard', 'very hard', 'incredibly hard']
          .map((d) => el('option', { value: d, selected: d === difficulty }, titleCase(d)))))),

    el('div', { class: 'ref-dc__result' },
      el('strong', { class: 'ref-dc__value' }, `DC ${result.dc}`),
      el('span', { class: 'faint' },
        `${result.base} by level`
        + (result.rarityAdjustment ? ` · ${signed(result.rarityAdjustment)} ${rarity}` : '')
        + (result.difficultyAdjustment ? ` · ${signed(result.difficultyAdjustment)} ${difficulty}` : '')
        + (result.clamped ? ' · level clamped to the printed table' : ''))),

    el('div', { class: 'ref-dc__simple' },
      el('span', { class: 'faint' }, 'Simple DCs'),
      ...Object.entries(SIMPLE_DC).map(([rank, dc]) => el('span', { class: 'pill' },
        `${titleCase(rank)} ${dc}`))));
}

const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;

/**
 * The reference tab.
 *
 * @param {object} options
 * @param {object} options.index      from `indexReference`
 * @param {object} options.ui         `{ query, entryId, dc }`
 * @param {Function} options.onChange patch the drawer's own state
 */
export function referenceTab({ index, ui, onChange }) {
  if (!index) return el('p', { class: 'muted' }, 'Loading the reference…');

  if (index.available === false) {
    return el('div', { class: 'empty' },
      el('p', {}, 'The reference has not been built.'),
      el('p', { class: 'faint' }, 'Run npm run build:reference and restart the server.'));
  }

  const results = ui.query ? searchReference(index, ui.query) : null;
  const entry = ui.entryId ? index.byId.get(ui.entryId) : null;

  const search = el('input', {
    class: 'input', type: 'search', id: 'ref-search',
    placeholder: 'Search tables, actions and conditions',
    value: ui.query ?? '',
    autocomplete: 'off',
    oninput: (event) => onChange({ query: event.target.value }),
  });

  const list = results
    ? el('div', { class: 'ref-results' },
      results.length
        ? el('p', { class: 'faint' },
          `${results.length} match${results.length === 1 ? '' : 'es'}`)
        : el('p', { class: 'faint' }, 'Nothing matches that.'),
      ...results.map((r) => entryRow(r, {
        onOpen: (id) => onChange({ entryId: id }),
        current: ui.entryId,
      })))
    : browsePanel(index, ui, onChange);

  return el('div', { class: 'ref' },
    el('div', { class: 'field' },
      el('label', { class: 'sr-only', for: 'ref-search' }, 'Search the reference'),
      search),

    dcCalculator({
      level: ui.dc.level,
      rarity: ui.dc.rarity,
      difficulty: ui.dc.difficulty,
      onChange: (patch) => onChange({ dc: { ...ui.dc, ...patch } }),
    }),

    // An open entry replaces the list rather than sitting under it. Following
    // a link from inside one entry to another otherwise lands the reader at
    // the bottom of a page they then have to scroll.
    entry
      ? el('div', { class: 'ref-detail' },
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('chevron')}<span>Back${ui.query ? ' to results' : ''}</span>`,
          onclick: () => onChange({ entryId: null }),
        }),
        entryPanel(entry))
      : list);
}

/** With no search, the drawer lists the groups so it can be browsed. */
function browsePanel(index, ui, onChange) {
  return el('div', { class: 'ref-groups' }, ...index.groups.map((group) => {
    const entries = index.entries.filter((e) => e.group === group.id);
    if (!entries.length) return null;
    const open = ui.openGroups?.includes(group.id);
    return el('section', { class: 'ref-group' },
      el('button', {
        class: 'ref-group__head', type: 'button', 'aria-expanded': String(Boolean(open)),
        onclick: () => onChange({
          openGroups: open
            ? ui.openGroups.filter((g) => g !== group.id)
            : [...(ui.openGroups ?? []), group.id],
        }),
        html: `<span>${group.label}</span><span class="faint">${entries.length}</span>${icon('chevronDown')}`,
      }),
      open
        ? el('div', { class: 'ref-group__body' }, ...entries.map((e) => entryRow(e, {
          onOpen: (id) => onChange({ entryId: id }),
          current: ui.entryId,
        })))
        : null);
  }).filter(Boolean));
}
