/**
 * Building the sheet.
 *
 * The DOM is built once and then updated in place. A full re-render on every
 * keystroke would be simpler and would also move the caret, close the keyboard
 * on a phone and lose the selection -- which is precisely the failure the
 * offline-first store exists to avoid, arriving by a different door.
 *
 * So: `mount()` builds the controls and registers an updater for each derived
 * value. `update(state)` runs the updaters. An input the player is currently
 * typing into is never written to.
 */
import { armorClass, classDc, statistic } from '../../../engine/rules/index.js';
import { el, formatMod, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { readPath } from './store.js';
import { guideCard } from './guide.js';
import {
  ATTRIBUTES, CONDITIONS, NOTES_SECTIONS, RANKS, SAVES, SKILLS, VALUED_CONDITIONS,
} from './fields.js';

export function mount(root, store, { onImport = () => {} } = {}) {
  const updaters = [];
  const onUpdate = (fn) => updaters.push(fn);

  /** Bind a control to a path. The store is the only writer of sheet values. */
  function bind(node, path, { parse = (v) => v, format = (v) => (v ?? ''), event = 'input' } = {}) {
    node.addEventListener(event, () => {
      const parsed = parse(node.type === 'checkbox' ? node.checked : node.value);
      store.set(path, parsed);
    });
    onUpdate((state) => {
      // Never fight the player for their own caret.
      if (document.activeElement === node) return;
      const value = readPath(state.sheet, path);
      if (node.type === 'checkbox') node.checked = Boolean(value);
      else node.value = format(value);
    });
    return node;
  }

  const text = (path, attrs = {}) =>
    bind(el('input', { class: 'input', type: 'text', ...attrs }), path);

  const number = (path, attrs = {}) => bind(
    el('input', { class: 'input input--number', type: 'number', inputmode: 'numeric', ...attrs }),
    path,
    { parse: (v) => (v === '' ? null : Number(v)), format: (v) => (v ?? '') },
  );

  const area = (path, attrs = {}) =>
    bind(el('textarea', { class: 'textarea', rows: 5, ...attrs }), path);

  const labelled = (label, control) => {
    const id = `f-${Math.random().toString(36).slice(2, 9)}`;
    control.id = id;
    return el('div', { class: 'field' },
      el('label', { class: 'field__label', for: id }, label),
      control);
  };

  const rankSelect = (path) => bind(
    el('select', { class: 'rank-select' },
      ...RANKS.map((rank) => el('option', { value: rank }, titleCase(rank)))),
    path,
    { format: (v) => v ?? 'untrained', event: 'change' },
  );

  /**
   * One computed statistic, with an override.
   *
   * The computed value is always shown, even when overridden, because the
   * question a player actually asks is "why is this different from what I
   * expected" and hiding the calculation makes that unanswerable.
   */
  function stat(label, { compute, overridePath, workingOf }) {
    const total = el('strong', { class: 'stat__total tabular' }, '—');
    const working = el('span', { class: 'stat__working' });
    const mark = el('span', { class: 'override-mark' });
    const override = bind(
      el('input', {
        class: 'stat__override', type: 'number', inputmode: 'numeric',
        'aria-label': `${label} override`, placeholder: 'auto',
      }),
      overridePath,
      { parse: (v) => (v === '' ? null : Number(v)), format: (v) => (v ?? '') },
    );

    onUpdate((state) => {
      const result = compute(state.sheet);
      total.textContent = result.format ? result.format(result.total) : formatMod(result.total);
      working.textContent = workingOf ? workingOf(result) : '';
      const isOverridden = result.overridden;
      mark.textContent = isOverridden ? 'set by hand' : '';
      override.classList.toggle('is-overridden', isOverridden);
      total.title = isOverridden ? `Computed: ${result.computed}` : '';
    });

    return el('div', { class: 'stat' },
      el('span', { class: 'stat__label' }, el('span', {}, label), mark),
      el('div', { class: 'stat__value' }, total, working, override));
  }

  // --- the statistic definitions ----------------------------------------

  const attrMod = (sheet, key) => Number(readPath(sheet, `abilities.${key}`) ?? 0);
  const level = (sheet) => Number(sheet.level ?? 1);

  const skillStat = (key, attribute) => (sheet) => statistic({
    attributeMod: attrMod(sheet, attribute),
    rank: readPath(sheet, `skills.${key}.rank`) ?? 'untrained',
    level: level(sheet),
    itemBonus: Number(readPath(sheet, `skills.${key}.itemBonus`) ?? 0),
    other: Number(readPath(sheet, `skills.${key}.other`) ?? 0),
    override: readPath(sheet, `skills.${key}.override`) ?? null,
  });

  const workingText = (r) => `${formatMod(r.components.attributeMod)} attr `
    + `${formatMod(r.components.proficiency)} prof`
    + (r.components.itemBonus ? ` ${formatMod(r.components.itemBonus)} item` : '');

  // --- sections ----------------------------------------------------------

  const identity = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Character'),
    el('div', { class: 'grid grid--2' },
      labelled('Character name', text('name')),
      labelled('Player', text('playerName')),
      labelled('Ancestry', text('ancestry')),
      labelled('Heritage', text('heritage')),
      labelled('Background', text('background')),
      labelled('Class', text('class')),
      labelled('Subclass', text('subclass')),
      labelled('Level', number('level')),
      labelled('Key attribute', bind(
        el('select', { class: 'select' },
          el('option', { value: '' }, '—'),
          ...ATTRIBUTES.map(([key, name]) => el('option', { value: key }, name))),
        'keyAttribute', { event: 'change', format: (v) => v ?? '' })),
      labelled('Size', text('size'))));

  const attributes = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Attribute modifiers'),
    el('div', { class: 'grid grid--3' },
      ...ATTRIBUTES.map(([key, name]) => labelled(name, number(`abilities.${key}`)))));

  const defence = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Defence'),
    el('div', { class: 'grid' },
      stat('Armour Class', {
        compute: (sheet) => {
          const shieldRaised = Boolean(readPath(sheet, 'shield.raised'));
          const result = armorClass({
            dexMod: attrMod(sheet, 'dex'),
            dexCap: readPath(sheet, 'ac.dexCap') ?? null,
            rank: readPath(sheet, 'ac.rank') ?? 'untrained',
            level: level(sheet),
            itemBonus: Number(readPath(sheet, 'ac.itemBonus') ?? 0),
            other: Number(readPath(sheet, 'ac.other') ?? 0),
            shieldBonus: Number(readPath(sheet, 'shield.bonus') ?? 0),
            shieldRaised,
            override: readPath(sheet, 'ac.override') ?? null,
          });
          return { ...result, format: (n) => String(n) };
        },
        overridePath: 'ac.override',
        workingOf: (r) => `10 ${formatMod(r.components.dexApplied)} dex`
          + (r.components.dexCapped ? ' (capped)' : '')
          + ` ${formatMod(r.components.proficiency)} prof`
          + (r.components.itemBonus ? ` ${formatMod(r.components.itemBonus)} item` : '')
          + (r.components.shield ? ` ${formatMod(r.components.shield)} shield` : ''),
      }),
      el('div', { class: 'grid grid--3' },
        labelled('AC proficiency', rankSelect('ac.rank')),
        labelled('Item bonus', number('ac.itemBonus')),
        labelled('Dex cap', number('ac.dexCap'))),
      hitPoints(),
      shield(),
      el('div', { class: 'grid grid--3' },
        labelled('Immunities', text('immunities')),
        labelled('Weaknesses', text('weaknesses')),
        labelled('Resistances', text('resistances')))));

  function hitPoints() {
    // A <progress> element rather than a styled div: it is the semantics a
    // health bar actually has, a screen reader reads it without help, and it
    // needs no inline style -- which the Content-Security-Policy forbids.
    const bar = el('progress', {
      class: 'hp-bar', value: '0', max: '1',
      'aria-label': 'Hit points remaining',
    });
    const damage = el('input', {
      class: 'input', type: 'number', inputmode: 'numeric', placeholder: 'Damage',
      'aria-label': 'Damage taken. A negative number heals.',
    });

    const apply = (sign) => {
      const amount = Number(damage.value);
      if (!Number.isFinite(amount) || amount === 0) return;
      const sheet = store.sheet;
      const max = Number(readPath(sheet, 'hp.max') ?? 0);
      const current = Number(readPath(sheet, 'hp.current') ?? max);
      let temp = Number(readPath(sheet, 'hp.temp') ?? 0);
      let remaining = amount * sign;

      if (remaining > 0 && temp > 0) {
        // Temporary hit points are spent first, and are not healed back.
        const absorbed = Math.min(temp, remaining);
        temp -= absorbed;
        remaining -= absorbed;
        store.set('hp.temp', temp);
      }
      store.set('hp.current', Math.max(0, Math.min(max, current - remaining)));
      damage.value = '';
      damage.focus();
    };

    onUpdate((state) => {
      const max = Number(readPath(state.sheet, 'hp.max') ?? 0);
      const current = Number(readPath(state.sheet, 'hp.current') ?? max);
      const fraction = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
      bar.value = fraction;
      bar.dataset.hurt = fraction > 0.5 ? 'none' : (fraction > 0.25 ? 'some' : 'badly');
      bar.setAttribute('aria-valuetext', `${current} of ${max} hit points`);
    });

    return el('div', {},
      el('div', { class: 'hp' },
        labelled('Current', number('hp.current')),
        labelled('Max', number('hp.max')),
        labelled('Temporary', number('hp.temp')),
        bar),
      el('div', { class: 'damage-entry stack-md' },
        damage,
        el('button', {
          class: 'btn', type: 'button', onclick: () => apply(1),
          html: `${icon('minus')}<span>Damage</span>`,
        }),
        el('button', {
          class: 'btn', type: 'button', onclick: () => apply(-1),
          html: `${icon('plus')}<span>Heal</span>`,
        })));
  }

  function shield() {
    const raised = bind(
      el('input', { type: 'checkbox', id: 'shield-raised' }),
      'shield.raised',
      { parse: Boolean, event: 'change' },
    );
    return el('div', {},
      el('h3', { class: 'heading-inline' }, 'Shield'),
      el('div', { class: 'grid grid--auto' },
        labelled('AC bonus', number('shield.bonus')),
        labelled('Hardness', number('shield.hardness')),
        labelled('HP', number('shield.hp')),
        labelled('Break threshold', number('shield.breakThreshold'))),
      el('div', { class: 'checkbox-row' },
        raised,
        el('label', { for: 'shield-raised' }, 'Raised (adds its bonus to AC)')));
  }

  const proficiencies = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Perception, saves and Class DC'),
    el('div', { class: 'grid' },
      stat('Perception', {
        compute: (sheet) => statistic({
          attributeMod: attrMod(sheet, 'wis'),
          rank: readPath(sheet, 'perception.rank') ?? 'untrained',
          level: level(sheet),
          itemBonus: Number(readPath(sheet, 'perception.itemBonus') ?? 0),
          override: readPath(sheet, 'perception.override') ?? null,
        }),
        overridePath: 'perception.override',
        workingOf: workingText,
      }),
      el('div', { class: 'grid grid--2' },
        labelled('Perception proficiency', rankSelect('perception.rank')),
        labelled('Senses', text('senses'))),
      ...SAVES.map(([key, name, attribute]) => el('div', { class: 'grid grid--2' },
        stat(name, {
          compute: (sheet) => statistic({
            attributeMod: attrMod(sheet, attribute),
            rank: readPath(sheet, `saves.${key}.rank`) ?? 'untrained',
            level: level(sheet),
            itemBonus: Number(readPath(sheet, `saves.${key}.itemBonus`) ?? 0),
            override: readPath(sheet, `saves.${key}.override`) ?? null,
          }),
          overridePath: `saves.${key}.override`,
          workingOf: workingText,
        }),
        el('div', { class: 'grid' },
          labelled('Proficiency', rankSelect(`saves.${key}.rank`)),
          labelled('Note', text(`saves.${key}.note`, { placeholder: 'e.g. +1 vs magic' }))))),
      el('div', { class: 'grid grid--2' },
        stat('Class DC', {
          compute: (sheet) => {
            const key = sheet.keyAttribute || 'str';
            const result = classDc({
              attributeMod: attrMod(sheet, key),
              rank: readPath(sheet, 'classDc.rank') ?? 'untrained',
              level: level(sheet),
              override: readPath(sheet, 'classDc.override') ?? null,
            });
            return { ...result, format: (n) => String(n) };
          },
          overridePath: 'classDc.override',
          workingOf: (r) => `10 ${formatMod(r.components.attributeMod)} key `
            + `${formatMod(r.components.proficiency)} prof`,
        }),
        labelled('Class DC proficiency', rankSelect('classDc.rank')))));

  const skills = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Skills'),
    el('div', { class: 'skills' },
      ...SKILLS.map(([key, name, attribute]) => {
        const total = el('span', { class: 'skill__total' }, '—');
        onUpdate((state) => {
          const result = skillStat(key, attribute)(state.sheet);
          total.textContent = formatMod(result.total);
          total.classList.toggle('override-mark', result.overridden);
          total.title = result.overridden
            ? `Set by hand. Computed: ${formatMod(result.computed)}`
            : `${titleCase(attribute)} ${formatMod(result.components.attributeMod)}, `
              + `${result.components.rank}`;
        });
        return el('div', { class: 'skill' },
          el('span', { class: 'skill__name' }, name, el('span', { class: 'faint' }, ` ${attribute}`)),
          rankSelect(`skills.${key}.rank`),
          total);
      })),
    lores());

  function lores() {
    const list = el('div', { class: 'rows stack-md' });
    const rebuild = (state) => {
      const entries = readPath(state.sheet, 'lores') ?? [];
      if (list.dataset.count === String(entries.length)) return;
      list.dataset.count = String(entries.length);
      list.replaceChildren(...entries.map((entry, index) => el('div', { class: 'row' },
        el('div', { class: 'row__head' },
          bind(el('input', { class: 'input', type: 'text', 'aria-label': `Lore ${index + 1} name`,
            value: entry.name ?? '' }), `lores.${index}.name`),
          rankSelect(`lores.${index}.rank`),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            html: `${icon('x')}<span class="sr-only">Remove ${entry.name || 'this Lore'}</span>`,
            onclick: () => {
              const next = [...(store.sheet.lores ?? [])];
              next.splice(index, 1);
              store.set('lores', next);
            },
          })))));
    };
    onUpdate(rebuild);
    return el('div', {},
      el('h3', { class: 'heading-spaced' }, 'Lore skills'),
      list,
      el('button', {
        class: 'btn stack-sm', type: 'button',
        html: `${icon('plus')}<span>Add a Lore</span>`,
        onclick: () => store.set('lores', [...(store.sheet.lores ?? []), { name: '', rank: 'trained' }]),
      }));
  }

  const movement = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Movement and languages'),
    el('div', { class: 'grid grid--2' },
      labelled('Speed', number('speed')),
      labelled('Other speeds', text('otherSpeeds', { placeholder: 'fly 30, swim 20' })),
      labelled('Languages', text('languagesText')),
      labelled('Hero points', number('heroPoints'))));

  const strikes = repeatingSection('Strikes', 'strikes', (index) => [
    el('div', { class: 'row__head' },
      text(`strikes.${index}.name`, { placeholder: 'Weapon', 'aria-label': `Strike ${index + 1} name` }),
      removeButton('strikes', index)),
    el('div', { class: 'grid grid--3' },
      labelled('Attack', number(`strikes.${index}.mod`)),
      labelled('Damage', text(`strikes.${index}.damage`, { placeholder: '1d8+4' })),
      labelled('Type', text(`strikes.${index}.damageType`, { placeholder: 'slashing' }))),
    labelled('Traits', text(`strikes.${index}.traitsText`, { placeholder: 'agile, finesse' })),
  ], { name: '', mod: 0, damage: '', damageType: '', traitsText: '' });

  const spellcasting = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Spellcasting'),
    el('div', { class: 'grid grid--3' },
      labelled('Tradition', text('spellcasting.tradition')),
      labelled('Spell DC', number('spellcasting.dc')),
      labelled('Spell attack', number('spellcasting.attackMod'))),
    slotTracks(),
    el('div', { class: 'grid grid--2 stack-md' },
      labelled('Focus points', number('focus.current')),
      labelled('Focus pool', number('focus.pool'))));

  function slotTracks() {
    const wrap = el('div', { class: 'stack-md' });
    onUpdate((state) => {
      const ranks = readPath(state.sheet, 'spellcasting.ranks') ?? [];
      const signature = JSON.stringify(ranks.map((r) => [r.rank, r.slotsMax]));
      if (wrap.dataset.signature === signature) {
        // Only the pressed state changes; rebuilding would drop focus.
        for (const button of wrap.querySelectorAll('.slot')) {
          const { rank, slot } = button.dataset;
          const used = Number(readPath(state.sheet, `spellcasting.slotsUsed.${rank}`) ?? 0);
          button.setAttribute('aria-pressed', String(Number(slot) < used));
        }
        return;
      }
      wrap.dataset.signature = signature;
      wrap.replaceChildren(...ranks.map((entry) => {
        const max = Number(entry.slotsMax ?? 0);
        const track = el('div', { class: 'slot-track' },
          el('span', { class: 'muted slot-track__label' },
            entry.rank === 0 ? 'Cantrips' : `Rank ${entry.rank}`),
          ...Array.from({ length: max }, (unused, slot) => el('button', {
            class: 'slot', type: 'button',
            dataset: { rank: String(entry.rank), slot: String(slot) },
            'aria-pressed': 'false',
            html: `<span class="sr-only">Rank ${entry.rank} slot ${slot + 1}</span>`,
            onclick: () => {
              const key = `spellcasting.slotsUsed.${entry.rank}`;
              const used = Number(readPath(store.sheet, key) ?? 0);
              store.set(key, slot < used ? slot : slot + 1);
            },
          })));
        return track;
      }));
    });
    return wrap;
  }

  const conditions = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Conditions'),
    conditionPicker());

  function conditionPicker() {
    const chips = el('div', { class: 'chips' });
    const select = el('select', { class: 'select', 'aria-label': 'Add a condition' },
      el('option', { value: '' }, 'Add a condition…'),
      ...CONDITIONS.map((slug) => el('option', { value: slug }, titleCase(slug))));

    select.addEventListener('change', () => {
      if (!select.value) return;
      const current = readPath(store.sheet, 'conditions') ?? [];
      if (!current.some((c) => c.slug === select.value)) {
        store.set('conditions', [...current, {
          slug: select.value,
          value: VALUED_CONDITIONS.has(select.value) ? 1 : null,
        }]);
      }
      select.value = '';
    });

    onUpdate((state) => {
      const current = readPath(state.sheet, 'conditions') ?? [];
      const signature = JSON.stringify(current);
      if (chips.dataset.signature === signature) return;
      chips.dataset.signature = signature;
      chips.replaceChildren(...current.map((condition, index) => el('span', { class: 'pill pill--warn' },
        titleCase(condition.slug),
        condition.value === null || condition.value === undefined ? null : el('input', {
          class: 'input input--compact condition-value', type: 'number', inputmode: 'numeric',
          value: String(condition.value),
          'aria-label': `${titleCase(condition.slug)} value`,
          oninput: (event) => {
            const next = [...(store.sheet.conditions ?? [])];
            next[index] = { ...next[index], value: Number(event.target.value) };
            store.set('conditions', next);
          },
        }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          html: `${icon('x')}<span class="sr-only">Remove ${titleCase(condition.slug)}</span>`,
          onclick: () => store.set(
            'conditions',
            (store.sheet.conditions ?? []).filter((c) => c.slug !== condition.slug),
          ),
        }))));
    });

    return el('div', {}, chips, el('div', { class: 'stack-md' }, select));
  }

  const notes = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Feats, features and notes'),
    el('div', { class: 'grid grid--2' },
      ...NOTES_SECTIONS.map(([key, label]) => labelled(label, area(key)))));

  // --- repeating helpers --------------------------------------------------

  function removeButton(listPath, index) {
    return el('button', {
      class: 'btn btn--icon btn--quiet', type: 'button',
      html: `${icon('x')}<span class="sr-only">Remove entry ${index + 1}</span>`,
      onclick: () => {
        const next = [...(readPath(store.sheet, listPath) ?? [])];
        next.splice(index, 1);
        store.set(listPath, next);
      },
    });
  }

  function repeatingSection(title, listPath, rowFor, blank) {
    const list = el('div', { class: 'rows' });
    onUpdate((state) => {
      const entries = readPath(state.sheet, listPath) ?? [];
      if (list.dataset.count === String(entries.length)) return;
      list.dataset.count = String(entries.length);
      list.replaceChildren(...entries.map((entry, index) => el('div', { class: 'row' }, rowFor(index))));
      // The rows were rebuilt, so their bound updaters have to run once now.
      for (const fn of updaters) fn(store.state);
    });
    return el('section', { class: 'card' },
      el('h2', { class: 'section__title' }, title),
      list,
      el('button', {
        class: 'btn stack-sm', type: 'button',
        html: `${icon('plus')}<span>Add</span>`,
        onclick: () => store.set(listPath, [...(readPath(store.sheet, listPath) ?? []), { ...blank }]),
      }));
  }

  // Rebuilt when the sheet's shape changes rather than on every keystroke: what
  // it says depends on whether the sheet is blank and how many conditions are
  // on it, and neither of those changes while somebody is typing a note.
  const guideSlot = el('div', { class: 'section--wide' });
  let guideKey = null;
  onUpdate((state) => {
    const sheet = state.sheet ?? {};
    const key = [
      Boolean((sheet.name ?? '').trim() || sheet.class || sheet.level),
      (sheet.conditions ?? []).length,
      (sheet.name ?? '').trim(),
    ].join('|');
    if (key === guideKey) return;
    guideKey = key;
    // A card the player has folded away stays folded through a re-render.
    const wasOpen = guideSlot.firstElementChild?.open;
    const card = guideCard(sheet, { onImport });
    if (wasOpen !== undefined) card.open = wasOpen;
    guideSlot.replaceChildren(card);
  });

  root.replaceChildren(
    guideSlot,
    identity, attributes, defence, proficiencies, skills,
    movement, strikes, spellcasting, conditions, notes,
  );

  let updating = false;
  return function update(state) {
    // `repeatingSection` re-runs the updaters after a rebuild; without this
    // guard that recursion would run the whole list twice per change.
    if (updating) return;
    updating = true;
    try {
      for (const fn of updaters) fn(state);
    } finally {
      updating = false;
    }
  };
}
