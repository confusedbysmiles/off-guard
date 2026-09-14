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
import { armorClass, classDc, isDerivedPath, statistic } from '../../../engine/rules/index.js';
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

  /**
   * Lock a control the builder owns.
   *
   * Only for a character that has a build. A sheet typed in by hand or brought
   * across from Pathbuilder has no `build`, owns every one of its own fields,
   * and is untouched by this.
   *
   * Without it the sheet has two editors for one field and no warning: an
   * ancestry changed here would hold until the next save from the builder
   * silently put it back.
   */
  function lockIfDerived(node, state, path) {
    const build = state.sheet?.build;
    const owned = Boolean(build) && isDerivedPath(path, build);
    node.classList.toggle('is-derived', owned);
    // `readOnly` where it exists, because it keeps the value focusable and
    // selectable; `disabled` only where there is no such thing.
    if (node.tagName === 'SELECT' || node.type === 'checkbox') node.disabled = owned;
    else node.readOnly = owned;
    if (owned) node.title = 'Set in the character builder.';
    else if (node.title === 'Set in the character builder.') node.removeAttribute('title');
  }

  /** Bind a control to a path. The store is the only writer of sheet values. */
  function bind(node, path, { parse = (v) => v, format = (v) => (v ?? ''), event = 'input' } = {}) {
    node.addEventListener(event, () => {
      const parsed = parse(node.type === 'checkbox' ? node.checked : node.value);
      store.set(path, parsed);
    });
    onUpdate((state) => {
      lockIfDerived(node, state, path);
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

  /**
   * Who the character is.
   *
   * Last on the page and folded away, which is the opposite of where a form
   * puts it and the right place for a sheet. The name is already in the bar at
   * the top of every screen; these are the boxes you fill in once and never
   * open again.
   *
   * On a built character most of them are not boxes at all. The builder owns
   * ancestry, class, level and the rest, so each row asks `isDerivedPath` --
   * the same rule that locks them -- and simply leaves rather than standing
   * there greyed out. What is left is what is still the player's: who is
   * playing, and the subclass the builder does not offer yet.
   */
  const builtNote = el('p', { class: 'muted built-note', hidden: true },
    'Ancestry, class, level and the rest are set in the character builder, so '
    + 'they are not boxes here. What is left below is yours.');

  const identitySummary = el('p', { class: 'identity__summary', hidden: true });

  onUpdate((state) => {
    const sheet = state.sheet ?? {};
    const built = Boolean(sheet.build);
    builtNote.hidden = !built;
    identitySummary.hidden = !built;
    if (!built) return;
    const said = [sheet.heritage, sheet.ancestry, sheet.background, sheet.class]
      .filter(Boolean).join(' · ');
    identitySummary.textContent = said
      ? `${said} — level ${sheet.level ?? 1}`
      : `Level ${sheet.level ?? 1}`;
  });

  /** A row that leaves when the builder takes the field over. */
  const ownRow = (label, path, control) => {
    const row = labelled(label, control);
    onUpdate((state) => {
      row.hidden = Boolean(state.sheet?.build) && isDerivedPath(path, state.sheet.build);
    });
    return row;
  };

  const identityFields = el('div', { class: 'grid grid--2' },
    ownRow('Character name', 'name', text('name')),
    ownRow('Player', 'playerName', text('playerName')),
    ownRow('Ancestry', 'ancestry', text('ancestry')),
    ownRow('Heritage', 'heritage', text('heritage')),
    ownRow('Background', 'background', text('background')),
    ownRow('Class', 'class', text('class')),
    ownRow('Subclass', 'subclass', text('subclass')),
    ownRow('Level', 'level', number('level')),
    ownRow('Key attribute', 'keyAttribute', bind(
      el('select', { class: 'select' },
        el('option', { value: '' }, '—'),
        ...ATTRIBUTES.map(([key, name]) => el('option', { value: key }, name))),
      'keyAttribute', { event: 'change', format: (v) => v ?? '' })),
    ownRow('Size', 'size', text('size')));

  const identity = el('details', { class: 'card section--wide', id: 'identity' },
    el('summary', { class: 'fold__summary fold__summary--card' },
      el('h2', { class: 'section__title' }, 'Character'),
      el('span', { class: 'faint' }, 'Name, ancestry, class, level')),
    builtNote,
    identitySummary,
    identityFields);

  /**
   * Open on a sheet that has nothing on it yet, because then this card is the
   * whole job. Once, on the first sheet that arrives: after that it is the
   * player's fold to open and close.
   */
  let identitySettled = false;
  onUpdate((state) => {
    if (identitySettled || !state.character) return;
    identitySettled = true;
    const sheet = state.sheet ?? {};
    identity.open = !(sheet.name || sheet.class || sheet.build);
  });

  const attributes = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Attribute modifiers'),
    el('div', { class: 'grid grid--3' },
      ...ATTRIBUTES.map(([key, name]) => labelled(name, number(`abilities.${key}`)))));

  /**
   * What you touch every round.
   *
   * Hit points, Armour Class and the shield, first on the page and together,
   * because they are the three things a player reaches for while the dice are
   * still rolling. They used to be the middle of a card called Defence, below
   * an identity form -- which put hit points two screens down a phone and
   * strikes five, on a sheet whose whole premise is one-handed use at a table.
   *
   * The parts that *make* Armour Class -- its proficiency, item bonus and
   * Dexterity cap -- are not here. Those are set once and are locked outright
   * on a built character, so they live further down with the rest of the
   * reference. The working beside the total already says what they came to.
   */
  const hp = hitPoints();

  const vitals = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Vitals'),
    el('div', { class: 'vitals__stats' },
      hp.display,
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
      perception()),
    hp.controls,
    el('div', { class: 'grid grid--auto stack-md' },
      labelled('Max', number('hp.max')),
      labelled('Temporary', number('hp.temp')),
      labelled('Hero points', number('heroPoints'))),
    shield());

  const armour = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Armour and resistances'),
    el('div', { class: 'grid grid--3' },
      labelled('AC proficiency', rankSelect('ac.rank')),
      labelled('Item bonus', number('ac.itemBonus')),
      labelled('Dex cap', number('ac.dexCap'))),
    el('div', { class: 'grid grid--3 stack-md' },
      labelled('Immunities', text('immunities')),
      labelled('Weaknesses', text('weaknesses')),
      labelled('Resistances', text('resistances'))));

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

    /**
     * Current hit points, given the same shape as a computed statistic.
     *
     * Not because it is computed -- it is the one number on the sheet that is
     * pure play state -- but because it is the number looked at most, and it
     * used to be one of three identical boxes labelled Current, Max and
     * Temporary, indistinguishable from the box that says Ancestry. Max and
     * Temporary went below with the other things nobody touches mid-fight.
     */
    const current = bind(
      el('input', {
        class: 'vital__now tabular', type: 'number', inputmode: 'numeric',
        'aria-label': 'Current hit points',
      }),
      'hp.current',
      { parse: (v) => (v === '' ? null : Number(v)), format: (v) => (v ?? '') },
    );
    const outOf = el('span', { class: 'stat__working' });

    onUpdate((state) => {
      const max = Number(readPath(state.sheet, 'hp.max') ?? 0);
      const now = Number(readPath(state.sheet, 'hp.current') ?? max);
      const temp = Number(readPath(state.sheet, 'hp.temp') ?? 0);
      const fraction = max > 0 ? Math.max(0, Math.min(1, now / max)) : 0;
      bar.value = fraction;
      bar.dataset.hurt = fraction > 0.5 ? 'none' : (fraction > 0.25 ? 'some' : 'badly');
      bar.setAttribute('aria-valuetext', `${now} of ${max} hit points`);
      outOf.textContent = `of ${max}${temp ? ` · ${temp} temporary` : ''}`;
    });

    return {
      display: el('div', { class: 'stat' },
        el('span', { class: 'stat__label' }, el('span', {}, 'Hit points')),
        el('div', { class: 'stat__value' }, current, outOf),
        bar),
      controls: el('div', { class: 'damage-entry stack-md' },
        damage,
        el('button', {
          class: 'btn', type: 'button', onclick: () => apply(1),
          html: `${icon('minus')}<span>Damage</span>`,
        }),
        el('button', {
          class: 'btn', type: 'button', onclick: () => apply(-1),
          html: `${icon('plus')}<span>Heal</span>`,
        })),
    };
  }

  /**
   * The shield, folded away when there is not one.
   *
   * Most characters carry no shield, and five empty boxes in the middle of the
   * first card is five boxes of nothing. It opens itself for a character who
   * has one -- once, on the first sheet that arrives, and never again, because
   * after that whether it is open is the player's business and not this
   * function's.
   */
  function shield() {
    const raised = bind(
      el('input', { type: 'checkbox', id: 'shield-raised' }),
      'shield.raised',
      { parse: Boolean, event: 'change' },
    );

    const state = el('span', { class: 'faint' });
    const block = el('details', { class: 'fold' },
      el('summary', { class: 'fold__summary' },
        el('strong', {}, 'Shield'), state),
      labelled('Which shield', text('shield.name', { placeholder: 'None' })),
      el('div', { class: 'grid grid--auto stack-md' },
        labelled('AC bonus', number('shield.bonus')),
        labelled('Hardness', number('shield.hardness')),
        labelled('HP', number('shield.hp')),
        labelled('Break threshold', number('shield.breakThreshold'))),
      el('div', { class: 'checkbox-row stack-md' },
        raised,
        el('label', { for: 'shield-raised' }, 'Raised (adds its bonus to AC)')));

    let settled = false;
    onUpdate((state_) => {
      const sheet = state_.sheet ?? {};
      const name = readPath(sheet, 'shield.name') ?? '';
      const bonus = Number(readPath(sheet, 'shield.bonus') ?? 0);
      const carried = Boolean(name || bonus);

      state.textContent = carried
        ? [name || 'Carried', bonus ? `+${bonus} AC when raised` : null,
          readPath(sheet, 'shield.raised') ? 'raised' : null].filter(Boolean).join(' · ')
        : 'None';

      // `character` rather than anything on the sheet: a blank sheet is the
      // case these folds are for, and "has no keys yet" cannot tell a sheet
      // that has not arrived from one that is empty.
      if (settled || !state_.character) return;
      settled = true;
      block.open = carried;
    });

    return block;
  }

  /**
   * Perception, which is also initiative.
   *
   * Up in Vitals rather than at the head of the saves card, because it is
   * rolled at the start of every encounter and then whenever anything is
   * hiding. Its proficiency and the senses that modify it stay below with the
   * saves, where the rest of the rank selects are.
   */
  function perception() {
    return stat('Perception', {
      compute: (sheet) => statistic({
        attributeMod: attrMod(sheet, 'wis'),
        rank: readPath(sheet, 'perception.rank') ?? 'untrained',
        level: level(sheet),
        itemBonus: Number(readPath(sheet, 'perception.itemBonus') ?? 0),
        override: readPath(sheet, 'perception.override') ?? null,
      }),
      overridePath: 'perception.override',
      workingOf: workingText,
    });
  }

  const proficiencies = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Saves and Class DC'),
    el('div', { class: 'grid' },
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

  // Hero points are spent mid-roll, so they are in Vitals rather than here.
  const movement = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Movement and languages'),
    el('div', { class: 'grid grid--auto' },
      labelled('Speed', number('speed')),
      labelled('Other speeds', text('otherSpeeds', { placeholder: 'fly 30, swim 20' })),
      labelled('Languages', text('languagesText'))));

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

  /**
   * Money and the bag.
   *
   * Every field here binds the same way the rest of the sheet does, which means
   * a built character finds them read-only and a hand-typed or imported one
   * finds them editable -- the builder owns what it derives and nothing else.
   * See `lockIfDerived`.
   *
   * Bulk is the exception: nobody types it, it is worked out from what is on
   * the list, and a character with no build has no list to work it out from.
   * So it appears only when there is one.
   */
  function carriedSection() {
    const bulkLine = el('p', { class: 'muted carried__bulk' });
    onUpdate((state) => {
      // Nothing carried is nothing to say: an empty bag weighing "—" is a
      // line that reads like a fault.
      const bulk = readPath(state.sheet, 'bulk');
      bulkLine.hidden = !bulk?.tenths;
      if (!bulk?.tenths) return;
      bulkLine.textContent = bulk.overloaded
        ? `${bulk.text} — over the maximum of ${bulk.maxAt}.`
        : bulk.encumbered
          ? `${bulk.text} — encumbered: clumsy 1 and 10 feet slower.`
          : `${bulk.text} carried. Encumbered above ${bulk.encumberedAt}.`;
      bulkLine.classList.toggle('is-warn', Boolean(bulk.encumbered));
    });

    const coins = el('div', { class: 'grid grid--auto' },
      labelled('Platinum', number('coins.pp')),
      labelled('Gold', number('coins.gp')),
      labelled('Silver', number('coins.sp')),
      labelled('Copper', number('coins.cp')));

    return repeatingSection('Carried', 'gear', (index) => [
      el('div', { class: 'row__head' },
        text(`gear.${index}.name`, {
          placeholder: 'Something', 'aria-label': `Item ${index + 1}`,
        }),
        removeButton('gear', index)),
      labelled('How many', number(`gear.${index}.quantity`)),
    ], { name: '', quantity: 1 }, { above: el('div', { class: 'stack-md' }, coins, bulkLine) });
  }

  const carried = carriedSection();

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

  function repeatingSection(title, listPath, rowFor, blank, { above = null } = {}) {
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
      above,
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

  /**
   * The order of the page, which is the whole point of it.
   *
   * Play order, not the order a form is filled in. What you touch every round
   * comes first -- what is left of you, what you hit with, what is on you --
   * then what you roll, then what you look up, then what you set once.
   *
   * The sheet was laid out the other way round when it was the only place a
   * character existed and every field on it had to be typed. The builder is
   * that place now, so the sheet can stop being a form and be a sheet.
   */
  root.replaceChildren(
    guideSlot,
    // Every round.
    vitals, strikes, conditions,
    // Rolled.
    proficiencies, skills, spellcasting,
    // Looked up.
    carried, movement, armour, attributes,
    // Written once.
    notes, identity,
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
