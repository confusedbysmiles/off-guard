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
import { adjustFormulaFlat } from '../../../engine/shared/damage-expression.js';
import { displayTitles } from '../lib/handout-titles.js';
import {
  armorClass, classDc, effectsOn, isDerivedPath, statistic,
} from '../../../engine/rules/index.js';
import { el, formatMod, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { readPath } from './store.js';
import { guideCard } from './guide.js';
import {
  ATTRIBUTES, CONDITIONS, NOTES_SECTIONS, RANKS, SAVES, SKILLS, VALUED_CONDITIONS,
} from './fields.js';

/** Which panel this browser was last looking at. */
const TAB_KEY = 'off-guard:sheet-tab';

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
    bind(el('textarea', { class: 'textarea', rows: 3, ...attrs }), path);

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
   * A statistic the way a sheet shows one, rather than the way a form does.
   *
   * What it is, what it comes to, and its machinery one tap away. The number
   * is the biggest thing in the row, because the number is what somebody
   * reached for the sheet to find.
   *
   * What this replaced put a proficiency dropdown in the middle of every row,
   * drawn larger and brighter than the modifier beside it -- sixteen times on
   * the skills card, and on a built character every one of them disabled,
   * since the builder owns the ranks. A page of loud controls nobody may touch,
   * around the values everybody wants.
   */
  let rowSeq = 0;
  function statRow({
    label, sub = null, compute, format = formatMod, detail = [], workingOf = workingText,
  }) {
    const id = `row-${rowSeq += 1}`;
    const value = el('strong', { class: 'stat-row__value tabular' }, '—');
    const rank = el('span', { class: 'stat-row__rank' });
    /**
     * The arithmetic, in the fold rather than in a tooltip.
     *
     * "Why is this not the number I expected" is the question the working
     * exists to answer, and a `title` answers it only for somebody with a
     * mouse. This sheet is used on a phone, where there is no hover at all.
     */
    const working = el('p', { class: 'stat-row__working' });
    const body = el('div', { class: 'stat-row__detail', id, hidden: true },
      working,
      el('div', { class: 'grid grid--auto' }, ...detail));

    const head = el('button', {
      class: 'stat-row__head', type: 'button',
      'aria-expanded': 'false', 'aria-controls': id,
      onclick: () => {
        const open = body.hidden;
        body.hidden = !open;
        head.setAttribute('aria-expanded', String(open));
      },
    },
    el('span', { class: 'stat-row__name' },
      label,
      sub ? el('span', { class: 'stat-row__sub' }, sub) : null),
    rank,
    value,
    el('span', { class: 'stat-row__chevron', 'aria-hidden': 'true', html: icon('chevron') }));

    const row = el('div', { class: 'stat-row' });

    onUpdate((state) => {
      const result = compute(state.sheet);
      value.textContent = format(result.total);
      value.classList.toggle('is-overridden', Boolean(result.overridden));

      /**
       * The rank, only when there is one worth saying.
       *
       * Most characters are untrained in most skills, and "Untrained" written
       * fourteen times down a column is a column nobody reads. Left blank, the
       * few rows that do carry a word are the trained ones, which is the thing
       * the eye was hunting for.
       */
      const named = String(result.components?.rank ?? '');
      const untrained = !named || named === 'untrained';
      rank.textContent = result.overridden ? 'by hand' : (untrained ? '' : titleCase(named));
      row.classList.toggle('stat-row--untrained', untrained && !result.overridden);
      working.textContent = result.overridden
        ? `Set by hand. Worked out, it would be ${format(result.computed)}.`
        : (result.components ? workingOf(result) : '');
    });

    row.replaceChildren(head, body);
    return row;
  }

  // --- the statistic definitions ----------------------------------------

  const attrMod = (sheet, key) => Number(readPath(sheet, `abilities.${key}`) ?? 0);
  const level = (sheet) => Number(sheet.level ?? 1);

  /**
   * What is in play on this sheet, worked out once per update.
   *
   * Every row asks the same question of the same list, and the sheet has
   * twenty-five of them. The store mutates its sheet in place rather than
   * replacing it, so this cannot key on identity -- it is cleared at the top
   * of each pass instead, which is the only moment the answer can change.
   */
  let inPlayCache = null;
  const inPlay = (sheet) => {
    if (!inPlayCache) inPlayCache = effectsOn(sheet);
    return inPlayCache;
  };

  /**
   * A statistic with whatever is in play folded in.
   *
   * Added here rather than written to the sheet. `strikes` and the ranks are
   * the builder's, and a raging barbarian's +2 stored on one of them would be
   * overwritten the next time the build saved -- and, worse, would stay on the
   * sheet after the rage ended. Nothing is ever written to the field it
   * changes, so turning an effect off restores the number exactly.
   */
  const affected = (target, compute, context = null) => (sheet) => {
    const base = compute(sheet);
    const effect = inPlay(sheet).on(target, context ? context(sheet) : {});
    if (!effect.total) return base;
    return { ...base, total: base.total + effect.total, effect };
  };

  const skillStat = (key, attribute) => (sheet) => statistic({
    attributeMod: attrMod(sheet, attribute),
    rank: readPath(sheet, `skills.${key}.rank`) ?? 'untrained',
    level: level(sheet),
    itemBonus: Number(readPath(sheet, `skills.${key}.itemBonus`) ?? 0),
    other: Number(readPath(sheet, `skills.${key}.other`) ?? 0),
    override: readPath(sheet, `skills.${key}.override`) ?? null,
  });

  /**
   * What an effect contributed, named.
   *
   * "-2" with no author is the thing this feature could most easily get
   * wrong: a number that moved and will not say why is worse than a number
   * the player works out themselves.
   */
  const effectText = (r) => (r.effect?.parts ?? [])
    .map((part) => ` ${formatMod(part.value)} ${part.from}`)
    .join('');

  const workingText = (r) => `${formatMod(r.components.attributeMod)} attr `
    + `${formatMod(r.components.proficiency)} prof`
    + (r.components.itemBonus ? ` ${formatMod(r.components.itemBonus)} item` : '')
    + effectText(r);

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
    hp.display,
    hp.controls,
    el('div', { class: 'stat-rows stack-md' },
      statRow({
        label: 'Armour Class',
        format: String,
        compute: affected('ac', (sheet) => armorClass({
          dexMod: attrMod(sheet, 'dex'),
          dexCap: readPath(sheet, 'ac.dexCap') ?? null,
          rank: readPath(sheet, 'ac.rank') ?? 'untrained',
          level: level(sheet),
          itemBonus: Number(readPath(sheet, 'ac.itemBonus') ?? 0),
          other: Number(readPath(sheet, 'ac.other') ?? 0),
          shieldBonus: Number(readPath(sheet, 'shield.bonus') ?? 0),
          shieldRaised: Boolean(readPath(sheet, 'shield.raised')),
          override: readPath(sheet, 'ac.override') ?? null,
        })),
        workingOf: (r) => `10 ${formatMod(r.components.dexApplied)} dex`
          + (r.components.dexCapped ? ' (capped by your armour)' : '')
          + ` ${formatMod(r.components.proficiency)} prof`
          + (r.components.itemBonus ? ` ${formatMod(r.components.itemBonus)} item` : '')
          + (r.components.shield ? ` ${formatMod(r.components.shield)} shield` : '')
          + effectText(r),
        detail: [
          labelled('Proficiency', rankSelect('ac.rank')),
          labelled('Item bonus', number('ac.itemBonus')),
          labelled('Dex cap', number('ac.dexCap')),
          labelled('Set by hand', number('ac.override', { placeholder: 'auto' })),
        ],
      }),
      perception()),
    el('div', { class: 'grid grid--auto stack-md' },
      labelled('Max', number('hp.max')),
      labelled('Temporary', number('hp.temp')),
      labelled('Hero points', number('heroPoints'))),
    shield());

  /**
   * What hurts this character less, or more.
   *
   * Three free-text lines and nothing computed, so they are shown only when
   * they say something -- most characters have none of the three, and three
   * empty boxes labelled Immunities is how a sheet starts looking like a form
   * somebody abandoned halfway.
   */
  const resistanceFields = ['immunities', 'weaknesses', 'resistances']
    .map((path) => labelled(titleCase(path), text(path)));

  const armour = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Immunities, weaknesses and resistances'),
    el('div', { class: 'grid grid--3' }, ...resistanceFields));

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
    return statRow({
      label: 'Perception',
      compute: affected('perception', (sheet) => statistic({
        attributeMod: attrMod(sheet, 'wis'),
        rank: readPath(sheet, 'perception.rank') ?? 'untrained',
        level: level(sheet),
        itemBonus: Number(readPath(sheet, 'perception.itemBonus') ?? 0),
        override: readPath(sheet, 'perception.override') ?? null,
      })),
      detail: [
        labelled('Item bonus', number('perception.itemBonus')),
        labelled('Set by hand', number('perception.override', { placeholder: 'auto' })),
      ],
    });
  }

  const saveNote = el('p', { class: 'faint stat-rows__note' });
  onUpdate((state) => {
    const notes = SAVES
      .map(([key, name]) => [name, readPath(state.sheet, `saves.${key}.note`)])
      .filter(([, note]) => (note ?? '').trim());
    saveNote.hidden = !notes.length;
    saveNote.textContent = notes.map(([name, note]) => `${name}: ${note}`).join(' · ');
  });

  const proficiencies = el('section', { class: 'card' },
    el('h2', { class: 'section__title' }, 'Saves and Class DC'),
    el('div', { class: 'stat-rows' },
      ...SAVES.map(([key, name, attribute]) => statRow({
        label: name,
        compute: affected(`saves.${key}`, (sheet) => statistic({
          attributeMod: attrMod(sheet, attribute),
          rank: readPath(sheet, `saves.${key}.rank`) ?? 'untrained',
          level: level(sheet),
          itemBonus: Number(readPath(sheet, `saves.${key}.itemBonus`) ?? 0),
          override: readPath(sheet, `saves.${key}.override`) ?? null,
        })),
        detail: [
          labelled('Proficiency', rankSelect(`saves.${key}.rank`)),
          labelled('Item bonus', number(`saves.${key}.itemBonus`)),
          labelled('Set by hand', number(`saves.${key}.override`, { placeholder: 'auto' })),
          labelled('Note', text(`saves.${key}.note`, { placeholder: 'e.g. +1 vs magic' })),
        ],
      })),
      statRow({
        label: 'Class DC',
        format: String,
        compute: affected('classDc', (sheet) => classDc({
          attributeMod: attrMod(sheet, sheet.keyAttribute || 'str'),
          rank: readPath(sheet, 'classDc.rank') ?? 'untrained',
          level: level(sheet),
          override: readPath(sheet, 'classDc.override') ?? null,
        })),
        workingOf: (r) => `10 ${formatMod(r.components.attributeMod)} key attribute `
          + `${formatMod(r.components.proficiency)} prof`
          + effectText(r),
        detail: [
          labelled('Proficiency', rankSelect('classDc.rank')),
          labelled('Set by hand', number('classDc.override', { placeholder: 'auto' })),
        ],
      })),
    // A note on a save is worth reading without opening anything, and is
    // almost always absent -- so it appears only when there is one.
    saveNote);

  const skills = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Skills'),
    el('div', { class: 'stat-rows' },
      ...SKILLS.map(([key, name, attribute]) => statRow({
        label: name,
        sub: attribute,
        compute: affected(`skills.${key}`, skillStat(key, attribute)),
        detail: [
          labelled('Proficiency', rankSelect(`skills.${key}.rank`)),
          labelled('Item bonus', number(`skills.${key}.itemBonus`)),
          labelled('Other', number(`skills.${key}.other`)),
          labelled('Set by hand', number(`skills.${key}.override`, { placeholder: 'auto' })),
        ],
      }))),
    el('div', { class: 'grid grid--2 stack-md' },
      labelled('Perception proficiency', rankSelect('perception.rank')),
      labelled('Senses', text('senses'))),
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
          /**
           * The number, which every other skill on this card has had and a
           * Lore never did.
           *
           * A Lore is an ordinary Intelligence skill -- the only thing unusual
           * about it is that its name is typed rather than chosen -- so a row
           * that shows a name and a proficiency and no modifier is the one
           * row on the sheet that makes you do the arithmetic yourself.
           */
          el('strong', {
            class: 'stat-row__value tabular lore__value',
            dataset: { loreIndex: String(index) },
            title: 'Intelligence, plus proficiency',
          }, '—'),
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

    /**
     * One updater for every Lore, rather than one per row.
     *
     * The rows are rebuilt whenever their number changes, and `updaters` only
     * ever grows -- so registering from inside `rebuild` would add a handler
     * per Lore per rebuild, each writing to a node that is no longer on the
     * page.
     */
    onUpdate((state) => {
      const entries = readPath(state.sheet, 'lores') ?? [];
      for (const node of list.querySelectorAll('[data-lore-index]')) {
        const entry = entries[Number(node.dataset.loreIndex)];
        if (!entry) continue;
        const base = statistic({
          attributeMod: attrMod(state.sheet, 'int'),
          rank: entry.rank ?? 'untrained',
          level: level(state.sheet),
          itemBonus: Number(entry.itemBonus ?? 0),
          other: Number(entry.other ?? 0),
          override: entry.override ?? null,
        });
        const effect = inPlay(state.sheet).on('skills.lore');
        node.textContent = formatMod(base.total + effect.total);
        node.classList.toggle('is-affected', Boolean(effect.total));
        node.title = effect.total
          ? `Intelligence, plus proficiency,${effectText({ effect })}`
          : 'Intelligence, plus proficiency';
      }
    });
    return el('div', {},
      el('h3', { class: 'heading-spaced' }, 'Lore skills'),
      list,
      el('button', {
        class: 'btn stack-sm', type: 'button',
        html: `${icon('plus')}<span>Add a Lore</span>`,
        onclick: () => store.set('lores', [...(store.sheet.lores ?? []), { name: '', rank: 'trained' }]),
      }));
  }

  /**
   * Effects: the things that change a number for a while.
   *
   * The whole list is written at once rather than field by field, the way
   * conditions and the bag are. The GM pushes effects through the same path,
   * and two writers at different depths of one array is how a version history
   * starts disagreeing with itself.
   *
   * Nothing here is a rule the application knows. The player says what Rage
   * does and turns it on; `effectsOn` adds it up wherever a number is drawn.
   */
  const EFFECT_TARGETS = [
    ['all', 'Every check and DC'],
    ['ac', 'Armour Class'],
    ['perception', 'Perception'],
    ['saves', 'All saves'],
    ['saves.fortitude', 'Fortitude'],
    ['saves.reflex', 'Reflex'],
    ['saves.will', 'Will'],
    ['skills', 'All skills'],
    ...SKILLS.map(([key, name]) => [`skills.${key}`, name]),
    ['skills.lore', 'Lore skills'],
    ['strike.attack', 'Attack rolls'],
    ['strike.damage', 'Damage rolls'],
    ['classDc', 'Class DC'],
    ['speed', 'Speed'],
  ];

  const EFFECT_TYPES = [
    ['status', 'Status'],
    ['circumstance', 'Circumstance'],
    ['item', 'Item'],
    ['untyped', 'Untyped'],
  ];

  const targetName = (value) => (EFFECT_TARGETS.find(([key]) => key === value) ?? [])[1] ?? value;

  function effectsSection() {
    const list = el('div', { class: 'rows stack-md' });
    const empty = el('p', { class: 'empty' },
      'Nothing running. An effect is anything that moves a number for a '
      + 'while — a rage, a spell, a potion — and it changes the sheet only '
      + 'while it is on.');

    const all = () => (store.sheet.effects ?? []).map((e) => ({ ...e }));
    const write = (next) => store.set('effects', next);
    const edit = (index, change) => {
      const next = all();
      next[index] = { ...next[index], ...change };
      write(next);
    };
    const editModifier = (index, at, change) => {
      const next = all();
      const modifiers = [...(next[index].modifiers ?? [])];
      modifiers[at] = { ...modifiers[at], ...change };
      next[index] = { ...next[index], modifiers };
      write(next);
    };

    const select = (options, value, onchange, label) => el('select', {
      class: 'rank-select', 'aria-label': label, onchange,
    }, ...options.map(([key, name]) => el('option', {
      value: key, selected: key === value,
    }, name)));

    function modifierRow(effect, index, modifier, at) {
      return el('div', { class: 'effect__modifier' },
        select(EFFECT_TARGETS, modifier.target, (e) => {
          editModifier(index, at, { target: e.target.value });
        }, 'What it changes'),
        select(EFFECT_TYPES, modifier.type ?? 'status', (e) => {
          editModifier(index, at, { type: e.target.value });
        }, 'Kind of modifier'),
        el('input', {
          class: 'input input--number', type: 'number', inputmode: 'numeric',
          'aria-label': 'By how much', value: String(modifier.value ?? 0),
          onchange: (e) => editModifier(index, at, { value: Number(e.target.value) || 0 }),
        }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          title: 'Remove this modifier',
          html: `${icon('x')}<span class="sr-only">Remove this modifier</span>`,
          onclick: () => {
            const next = all();
            next[index] = {
              ...next[index],
              modifiers: (next[index].modifiers ?? []).filter((_, i) => i !== at),
            };
            write(next);
          },
        }));
    }

    function effectRow(effect, index) {
      const modifiers = effect.modifiers ?? [];
      return el('div', { class: `row effect${effect.active === false ? ' effect--off' : ''}` },
        el('div', { class: 'row__head' },
          el('label', { class: 'effect__toggle' },
            el('input', {
              type: 'checkbox',
              checked: effect.active !== false,
              'aria-label': `${effect.name || 'This effect'} is on`,
              onchange: (e) => edit(index, { active: e.target.checked }),
            }),
            el('span', { class: 'sr-only' }, 'On')),
          el('input', {
            class: 'input', type: 'text', placeholder: 'Rage',
            'aria-label': `Effect ${index + 1} name`, value: effect.name ?? '',
            onchange: (e) => edit(index, { name: e.target.value }),
          }),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            title: `Remove ${effect.name || 'this effect'}`,
            html: `${icon('x')}<span class="sr-only">Remove ${effect.name || 'this effect'}</span>`,
            onclick: () => write(all().filter((_, i) => i !== index)),
          })),
        ...modifiers.map((modifier, at) => modifierRow(effect, index, modifier, at)),
        el('div', { class: 'effect__tools' },
          el('button', {
            class: 'btn btn--quiet', type: 'button',
            html: `${icon('plus')}<span>Add a modifier</span>`,
            onclick: () => edit(index, {
              modifiers: [...modifiers, { target: 'all', type: 'status', value: 1 }],
            }),
          }),
          el('input', {
            class: 'input effect__note', type: 'text',
            placeholder: 'Note — e.g. no Concentrate actions',
            'aria-label': `Note on effect ${index + 1}`, value: effect.note ?? '',
            onchange: (e) => edit(index, { note: e.target.value }),
          })));
    }

    /**
     * Rebuilt when the shape changes, not when a word does.
     *
     * The key counts the effects and their modifiers, so adding one redraws
     * the list and typing a name does not -- which matters because a redraw
     * takes the field out from under the player's caret.
     */
    const rebuild = (state) => {
      const entries = readPath(state.sheet, 'effects') ?? [];
      const key = `${entries.length}|${entries.map((e) => (e?.modifiers ?? []).length).join(',')}`;
      if (list.dataset.key !== key) {
        list.dataset.key = key;
        list.replaceChildren(...entries.map((effect, index) => effectRow(effect, index)));
      }
      empty.hidden = entries.length > 0;
    };
    onUpdate(rebuild);

    return el('section', { class: 'card' },
      el('h2', { class: 'section__title' }, 'Effects'),
      empty,
      list,
      el('button', {
        class: 'btn stack-sm', type: 'button',
        html: `${icon('plus')}<span>Add an effect</span>`,
        onclick: () => write([...all(), {
          id: `e${Date.now().toString(36)}`,
          name: '',
          active: true,
          modifiers: [{ target: 'all', type: 'status', value: 1 }],
        }]),
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
    /**
     * What this strike comes to right now.
     *
     * Beside the fields rather than in them. `strikes` is a derived path, so
     * the boxes above are the build's and are read-only on a built character
     * -- and even on a typed one, writing the rage into the box is how it
     * stays there after the rage ends.
     */
    el('p', { class: 'strike__effect', dataset: { strikeIndex: String(index) }, hidden: true }),
  ], { name: '', mod: 0, damage: '', damageType: '', traitsText: '' });

  /**
   * One updater for every strike, for the same reason the Lores have one: the
   * rows are rebuilt when their number changes and `updaters` only grows.
   */
  onUpdate((state) => {
    const entries = readPath(state.sheet, 'strikes') ?? [];
    for (const node of strikes.querySelectorAll('[data-strike-index]')) {
      const strike = entries[Number(node.dataset.strikeIndex)];
      if (!strike) continue;
      const effects = inPlay(state.sheet);
      const attack = effects.on('strike.attack', { strike });
      const damage = effects.on('strike.damage', { strike });
      node.hidden = !attack.total && !damage.total;
      if (node.hidden) continue;

      const said = [];
      if (attack.total) {
        said.push(`attack ${formatMod(Number(strike.mod ?? 0) + attack.total)}`
          + ` (${effectText({ effect: attack }).trim()})`);
      }
      if (damage.total) {
        said.push(`damage ${adjustFormulaFlat(strike.damage, damage.total)}`
          + ` (${effectText({ effect: damage }).trim()})`);
      }
      node.textContent = said.join(' · ');
    }
  });

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
      // Where it is packed. A plain field rather than a nested list: the
      // answer a player wants at a table is "is it in the backpack", and a
      // tree would make reordering and removing rows harder for a gain
      // nobody asked for.
      labelled('In', text(`gear.${index}.container`, {
        placeholder: 'Carried loose', 'aria-label': `What item ${index + 1} is packed in`,
      })),
    ], { name: '', quantity: 1, container: null }, {
      above: el('div', { class: 'stack-md' }, coins, bulkLine), wide: true,
    });
  }

  const carried = carriedSection();

  /**
   * Spellcasting, folded away for the characters who do none.
   *
   * Most do none, and five empty boxes headed Tradition, Spell DC and Spell
   * attack is how a sheet starts looking like a form somebody gave up on. It
   * opens itself for anyone who casts -- once, on the first sheet that arrives
   * -- and is a line of text otherwise, one tap from being a card again.
   */
  const spellcastingSummary = el('span', { class: 'faint' });
  const spellcastingFold = el('details', { class: 'fold' },
    el('summary', { class: 'fold__summary' },
      el('strong', {}, 'Spellcasting'), spellcastingSummary),
    el('div', { class: 'grid grid--3 stack-md' },
      labelled('Tradition', text('spellcasting.tradition')),
      labelled('Spell DC', number('spellcasting.dc')),
      labelled('Spell attack', number('spellcasting.attackMod'))),
    slotTracks(),
    el('div', { class: 'grid grid--2 stack-md' },
      labelled('Focus points', number('focus.current')),
      labelled('Focus pool', number('focus.pool'))));

  let castingSettled = false;
  onUpdate((state) => {
    const sheet = state.sheet ?? {};
    const tradition = String(readPath(sheet, 'spellcasting.tradition') ?? '').trim();
    const dc = Number(readPath(sheet, 'spellcasting.dc') ?? 0);
    const pool = Number(readPath(sheet, 'focus.pool') ?? 0);
    const ranks = (readPath(sheet, 'spellcasting.ranks') ?? []).length;
    const casts = Boolean(tradition || dc || pool || ranks);

    spellcastingSummary.textContent = casts
      ? [tradition && titleCase(tradition), dc && `DC ${dc}`, pool && `${pool} focus`]
        .filter(Boolean).join(' · ')
      : 'None';

    if (castingSettled || !state.character) return;
    castingSettled = true;
    spellcastingFold.open = casts;
  });

  const spellcasting = el('section', { class: 'card section--wide' },
    spellcastingFold);

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

  /**
   * The feats this character actually has.
   *
   * Rendered from the build rather than typed, because a feat is a choice from
   * a catalogue of 6,297 of them and the import already knows which ones. The
   * slots arrive resolved -- `filledName` and `filledLevel` per slot -- so this
   * needs no catalogue of its own.
   *
   * Empty until the builder has been loaded once; `setBuilderState` fills it.
   * A character with no build at all gets the invitation rather than a blank.
   */
  const featsList = el('div', { class: 'feats' });
  const featsCard = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Feats'),
    featsList);

  /**
   * The features a character is given rather than choosing.
   *
   * Derived from the build -- class, ancestry and heritage grants -- so this
   * needs no fetch and is right for a character built here as well as one
   * imported. Read-only for the same reason: nobody picks these.
   */
  const featuresList = el('div', { class: 'feats' });
  const featuresCard = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Class and ancestry features'),
    featuresList);

  onUpdate((state) => {
    const features = readPath(state.sheet, 'features') ?? [];
    if (!features.length) {
      featuresList.replaceChildren(el('p', { class: 'empty' },
        'Set an ancestry and a class in the builder and these fill in by themselves.'));
      return;
    }
    featuresList.replaceChildren(el('ul', { class: 'feats__list' },
      ...features.map((feature) => el('li', { class: 'feats__row' },
        el('span', { class: 'feats__name' }, feature.name),
        el('span', { class: 'faint feats__meta' },
          `${feature.source} · level ${feature.level}`)))));
  });

  const KIND_LABEL = {
    classFeat: 'Class', ancestryFeat: 'Ancestry',
    skillFeat: 'Skill', generalFeat: 'General',
  };

  function renderFeats(slots) {
    const feats = (slots ?? []).filter((slot) => KIND_LABEL[slot.kind]);
    if (!feats.length) {
      featsList.replaceChildren(el('p', { class: 'empty' },
        'No feats yet. Open the builder to choose them, or import a Pathbuilder '
        + 'export and they come across with everything else.'));
      return;
    }
    featsList.replaceChildren(el('ul', { class: 'feats__list' },
      ...feats
        .slice()
        .sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind))
        .map((slot) => el('li', {
          class: `feats__row${slot.filled ? '' : ' feats__row--empty'}`,
        },
        el('span', { class: 'feats__name' },
          slot.filledName ?? 'Not chosen'),
        el('span', { class: 'faint feats__meta' },
          // The slot's own label where it has one, so a bonus feat says it is
          // one -- otherwise a character with a granted general feat at the
          // same level as their own shows two identical lines.
          `${slot.label ?? KIND_LABEL[slot.kind]} · level ${slot.level}`)))));
  }

  renderFeats(null);

  /**
   * Handouts the GM has released.
   *
   * Behind the same link the sheet is: no Google account, no sharing
   * settings, nothing public. Filled by `showHandouts` once they have been
   * fetched, and hidden when there are none -- an empty card on every sheet
   * of every table that uses no handouts is furniture.
   */
  const handoutsList = el('div', { class: 'handouts-card__list' });
  const handoutsCard = el('section', { class: 'card section--wide', hidden: true },
    el('h2', { class: 'section__title' }, 'Handouts'),
    handoutsList);

  function renderHandouts(handouts, href) {
    const rows = handouts ?? [];
    const { short } = displayTitles(rows);
    handoutsCard.hidden = rows.length === 0;
    // The tab appears with the first handout and goes away with the last.
    const tab = tabs.get('handouts');
    if (tab) tab.hidden = rows.length === 0;
    handoutsList.replaceChildren(...rows.map((handout) => el('a', {
      class: 'handout-link', href: href(handout.id), target: '_blank', rel: 'noopener',
    },
    el('span', { class: 'handout-link__title' }, short.get(handout.id) ?? handout.title),
    el('span', { class: 'faint handout-link__meta' },
      handout.contentType === 'application/pdf' ? 'PDF' : handout.filename))));
  }

  const notes = el('section', { class: 'card section--wide' },
    el('h2', { class: 'section__title' }, 'Reactions, items and notes'),
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

  function repeatingSection(title, listPath, rowFor, blank, { above = null, wide = false } = {}) {
    const list = el('div', { class: 'rows' });
    onUpdate((state) => {
      const entries = readPath(state.sheet, listPath) ?? [];
      if (list.dataset.count === String(entries.length)) return;
      list.dataset.count = String(entries.length);
      list.replaceChildren(...entries.map((entry, index) => el('div', { class: 'row' }, rowFor(index))));
      // The rows were rebuilt, so their bound updaters have to run once now.
      for (const fn of updaters) fn(store.state);
    });
    return el('section', { class: `card${wide ? ' section--wide' : ''}` },
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
   * Five panels, not one page.
   *
   * Everything a sheet holds is on it somewhere, and scrolling five thousand
   * pixels to find the one number you want is not a sheet, it is a filing
   * cabinet. Grouped by the question being asked -- what is happening in this
   * fight, what can I roll, what do I know, what am I carrying, who am I --
   * so the answer is one tap and a short scroll rather than a hunt.
   *
   * Ordered by how often a table reaches for them, so the tab you land on is
   * usually the tab you wanted.
   */
  const PANELS = [
    // Effects sit beside conditions because they are the same kind of thing:
    // what is true of this character right now, rather than what they are.
    ['combat', 'Combat', [vitals, strikes, conditions, effectsSection(), proficiencies, armour]],
    ['skills', 'Skills', [skills]],
    ['feats', 'Feats', [featsCard, featuresCard, notes, spellcasting]],
    ['gear', 'Gear', [carried]],
    ['character', 'Character', [attributes, movement, identity]],
    // Hidden, tab and all, until the GM releases something. A player told
    // "check the handouts" should find a tab called Handouts; a table that
    // uses none should not have an empty one.
    ['handouts', 'Handouts', [handoutsCard]],
  ];

  const panels = new Map(PANELS.map(([id, , cards]) => [
    id, el('div', { class: 'sheet__panel', id: `panel-${id}`, hidden: true }, ...cards),
  ]));

  const tabs = new Map(PANELS.map(([id, label]) => [
    id,
    el('button', {
      class: 'sheet-tab', type: 'button',
      // Handouts start hidden and appear when the GM releases one.
      hidden: id === 'handouts',
      onclick: () => showPanel(id),
    }, label),
  ]));

  function showPanel(id) {
    for (const [key, panel] of panels) panel.hidden = key !== id;
    for (const [key, tab] of tabs) {
      if (key === id) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    try { localStorage.setItem(TAB_KEY, id); } catch { /* private mode */ }
  }

  root.replaceChildren(
    guideSlot,
    el('nav', { class: 'sheet-tabs', 'aria-label': 'Sections' }, ...tabs.values()),
    ...panels.values(),
  );

  // Where you left off, because a session is not one sitting -- but Combat if
  // this browser has never said otherwise, which is what a table opens on.
  let wanted = 'combat';
  try { wanted = localStorage.getItem(TAB_KEY) ?? 'combat'; } catch { /* private mode */ }
  showPanel(panels.has(wanted) ? wanted : 'combat');

  let updating = false;

  /**
   * Hand the feats card the builder's slots.
   *
   * Separate from `update` because it comes from a different request on a
   * different schedule: the sheet loads first and is usable without it, and
   * this arrives when the builder state does.
   */
  update.showFeats = renderFeats;
  update.showHandouts = renderHandouts;

  function update(state) {
    // `repeatingSection` re-runs the updaters after a rebuild; without this
    // guard that recursion would run the whole list twice per change.
    if (updating) return;
    updating = true;
    inPlayCache = null;
    try {
      for (const fn of updaters) fn(state);
    } finally {
      updating = false;
    }
  }

  return update;
}
