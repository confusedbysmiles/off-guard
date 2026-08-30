/**
 * The option picker.
 *
 * One dialog, opened by a slot, answering the question that slot asks. The slot
 * carries its own filter -- see `slotsFor` -- so this file never needs to know
 * that a level 6 class feat means `category=class&trait=fighter&maxLevel=6`.
 * It asks the server what fits and shows it.
 *
 * The three things that make this less painful than the alternatives:
 *
 *   1. The list is pre-filtered to what is legal. A level 4 fighter looking for
 *      a class feat sees the forty-odd they can actually take, not six thousand
 *      feats with a search box over them.
 *   2. The full text is one keystroke away and does not close the list. Picking
 *      a feat means reading three of them side by side, and a picker that makes
 *      you leave to read is a picker you fight.
 *   3. Prerequisites are shown as printed and checked only where they can be
 *      read. "Trained in Athletics" is checkable; "you have a patron" is not,
 *      and pretending otherwise would refuse legal choices.
 */
import { el, debounce, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const RARITY_CLASS = { common: null, uncommon: 'warn', rare: 'bad', unique: 'bad' };

export function createPicker({ dialog, endpoint, onChoose }) {
  const title = el('h2', { id: 'picker-title' });
  const summary = el('p', { class: 'muted picker__summary' });
  const search = el('input', {
    type: 'search', class: 'input', id: 'picker-search',
    placeholder: 'Search by name', autocomplete: 'off',
    'aria-label': 'Search options',
  });
  const results = el('ul', { class: 'picker__results' });
  const status = el('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });

  let slot = null;
  let chosen = null;

  const clear = el('button', {
    class: 'btn btn--quiet', type: 'button',
    onclick: () => { onChoose(slot, null); dialog.close(); },
  }, 'Clear this choice');

  dialog.replaceChildren(el('div', { class: 'picker' },
    el('div', { class: 'picker__head' },
      title,
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        html: `${icon('x')}<span class="sr-only">Close</span>`,
        onclick: () => dialog.close(),
      })),
    summary,
    search,
    status,
    results,
    el('menu', { class: 'picker__actions' }, clear)));

  async function run() {
    if (!slot?.filter) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(slot.filter)) {
      if (value === null || value === undefined || value === '') continue;
      params.set(key, String(value));
    }
    if (search.value.trim()) params.set('q', search.value.trim());
    params.set('limit', '80');
    // Common first: see the note on the sort in `src/server/options.js`.
    if (!params.has('sort')) params.set('sort', 'rarity');

    status.textContent = 'Looking…';
    try {
      const res = await fetch(`${endpoint}/builder/options?${params}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const body = await res.json();
      render(body);
    } catch (error) {
      status.textContent = `Could not search: ${error.message}`;
      results.replaceChildren();
    }
  }

  function render(body) {
    const rows = body.rows ?? [];
    status.textContent = rows.length === body.total
      ? `${rows.length} ${rows.length === 1 ? 'option' : 'options'}`
      : `${rows.length} of ${body.total}`;

    results.replaceChildren(...rows.map((row) => {
      const isChosen = row.id === chosen;
      const detail = el('div', { class: 'picker__detail', hidden: true });
      let loaded = false;

      const reveal = el('button', {
        class: 'btn btn--quiet btn--icon picker__reveal', type: 'button',
        'aria-expanded': 'false',
        html: `${icon('chevron')}<span class="sr-only">Read ${row.name}</span>`,
        onclick: async (event) => {
          const open = detail.hidden;
          detail.hidden = !open;
          event.currentTarget.setAttribute('aria-expanded', String(open));
          if (open && !loaded) {
            loaded = true;
            detail.replaceChildren(el('p', { class: 'muted' }, 'Reading…'));
            detail.replaceChildren(await describe(row.id));
          }
        },
      });

      return el('li', { class: `picker__row${isChosen ? ' is-chosen' : ''}` },
        el('div', { class: 'picker__main' },
          el('button', {
            class: 'picker__choose', type: 'button',
            onclick: () => { onChoose(slot, row.id); dialog.close(); },
          },
          el('span', { class: 'picker__name' }, row.name),
          el('span', { class: 'picker__meta' },
            row.level > 0 ? el('span', { class: 'pill' }, `Level ${row.level}`) : null,
            row.rarity && row.rarity !== 'common'
              ? el('span', { class: `pill pill--${RARITY_CLASS[row.rarity] ?? 'warn'}` }, titleCase(row.rarity))
              : null,
            row.actionCost && row.actionCost !== 'passive'
              ? el('span', { class: 'pill' }, actionLabel(row.actionCost)) : null,
            row.hasPrerequisites ? el('span', { class: 'pill pill--warn' }, 'Has prerequisites') : null,
            isChosen ? el('span', { class: 'pill pill--good' }, 'Chosen') : null)),
          reveal),
        detail);
    }));

    if (!rows.length) {
      results.replaceChildren(el('li', { class: 'picker__row' },
        el('p', { class: 'muted' }, 'Nothing matches. Try a shorter search.')));
    }
  }

  /** One option in full, fetched only when someone asks to read it. */
  async function describe(id) {
    try {
      const res = await fetch(`${endpoint}/builder/options/${encodeURIComponent(id)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const { option } = await res.json();
      return el('div', { class: 'stack-sm' },
        option.prerequisites?.length
          ? el('p', {}, el('strong', {}, 'Prerequisites '), option.prerequisites.join(', '))
          : null,
        option.traits?.length
          ? el('div', { class: 'chips' }, ...option.traits.map((t) => el('span', { class: 'pill' }, titleCase(t))))
          : null,
        // Resolved at build time by the same markup resolver the creature
        // catalogue uses, so `@UUID` links and `@Damage` are already text.
        el('div', { class: 'rich', html: option.description?.html ?? '' }),
        el('p', { class: 'faint' }, option.source?.book ?? ''));
    } catch (error) {
      return el('p', { class: 'muted' }, `Could not read that: ${error.message}`);
    }
  }

  search.addEventListener('input', debounce(run, 200));

  return {
    open(nextSlot, currentValue = null) {
      slot = nextSlot;
      chosen = currentValue;
      title.textContent = nextSlot.label;
      summary.textContent = describeFilter(nextSlot);
      search.value = '';
      results.replaceChildren();
      status.textContent = '';
      clear.hidden = !currentValue;
      dialog.showModal();
      search.focus();
      run();
    },
  };
}

/** Said in words, so the list's narrowness is visible rather than mysterious. */
function describeFilter(slot) {
  const filter = slot.filter ?? {};
  const parts = [];
  if (filter.trait) parts.push(titleCase(filter.trait));
  if (filter.category) parts.push(`${filter.category} ${filter.kind ?? ''}`.trim());
  else if (filter.kind) parts.push(filter.kind);
  if (filter.maxLevel) parts.push(`level ${filter.maxLevel} and below`);
  if (filter.ancestry) parts.push('and versatile heritages');
  return parts.length ? `Showing ${parts.join(', ')}.` : '';
}

const ACTION_LABEL = {
  action: 'Action', reaction: 'Reaction', free: 'Free action', passive: '',
};
const actionLabel = (cost) => ACTION_LABEL[cost] ?? titleCase(cost);
