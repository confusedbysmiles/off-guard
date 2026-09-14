/**
 * What the character wears, wields and carries.
 *
 * Its own pair of panels rather than slots in the timeline, because equipment
 * is not a level choice: a character swaps a weapon mid-campaign and the level
 * they did it at is nobody's business.
 *
 * Every line here is three separate things -- the item the rules are about,
 * whatever has been done to it, and whatever the player calls it -- and keeping
 * them apart is what makes a `+1 striking longsword` named "Grandfather's
 * blade" a longsword with two numbers and a label. The damage dice, the traits
 * and the proficiency all go on working while the sheet says what the player
 * wanted it to say.
 *
 * The first of those three can come from the catalogue or from the player. A GM
 * who handed out a homebrew axe, or a book the compendium build has not caught
 * up with, leaves a character holding something real that is in no index, so
 * every row here can be described instead of chosen: a die, a damage type and a
 * proficiency category are all the arithmetic ever needed. Described items are
 * sanitised on the way into the rules -- see `customWeapon` and its neighbours
 * -- so a typo cannot reach a number.
 *
 * Nothing in this file computes one. Bulk, encumbrance, Armour Class and every
 * strike come back from the server's derivation -- see the note in `state.js`
 * -- so this panel and the player's sheet cannot disagree about what somebody
 * is carrying or whether they can walk with it.
 */
import { el, debounce, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { COINS, bulkText, coinValue, priceText } from '../../../engine/rules/character/bulk.js';

const POTENCY = [0, 1, 2, 3];
const STRIKING = [
  [0, 'No striking rune'], [1, 'Striking'], [2, 'Greater striking'], [3, 'Major striking'],
];

const DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];
const DAMAGE_TYPES = ['bludgeoning', 'piercing', 'slashing'];
const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_CATEGORIES = ['unarmored', 'light', 'medium', 'heavy'];

/**
 * What each picker asks for.
 *
 * Capped at the character's own level, because the catalogue holds 5,855 items
 * and an alphabetical list of them opens on a level 18 solvent for a level 5
 * character. `relaxable` names the filters that are a convenience rather than a
 * rule, and the picker offers one box that lifts all of them -- unlike a feat
 * slot, whose level cap is the rules and gets no box, because taking a level 12
 * feat at level 4 is not a thing you are allowed to want.
 */
const itemSlot = (kind, label, itemType, level) => ({
  id: kind,
  kind,
  label,
  relaxable: ['maxLevel'],
  relaxLabel: 'Show items above your level',
  filter: { kind: 'equipment', itemType, maxLevel: level },
});

const ARMOR_SLOT = (level) => itemSlot('armor', 'Armour', 'armor', level);
const SHIELD_SLOT = (level) => itemSlot('shield', 'Shield', 'shield', level);
const GEAR_SLOT = (level) => itemSlot('gear', 'Carried item', null, level);

/** The weapon proficiencies a class tracks. Anything else is not a category. */
const ATTACK_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced'];

/**
 * Weapons the character can actually use.
 *
 * A wizard sees 338 of the 1,013 weapons in the catalogue rather than all of
 * them, which is the difference between a list and a search box.
 *
 * Two reasons it lifts rather than enforces. A class can be proficient with
 * weapons outside its categories, named rather than ranked -- a cleric's
 * deity's favored weapon, an alchemist's bombs, which are martial weapons a
 * class untrained in martial weapons throws all day -- and a feat can grant one
 * the same way. Neither is a rank, so this filter cannot see either, and the
 * three classes that have one say so beside the box that turns this off.
 *
 * A character with no class yet is filtered by nothing: "untrained in
 * everything" is not what an empty slot means.
 */
const WEAPON_SLOT = (level, proficiencies) => {
  const attacks = proficiencies?.attacks ?? {};
  const trained = ATTACK_CATEGORIES.filter((key) => (attacks[key] ?? 'untrained') !== 'untrained');
  const specific = attacks.other?.name ?? null;

  return {
    ...itemSlot('weapon', 'Weapon', 'weapon', level),
    relaxable: trained.length ? ['maxLevel', 'categories'] : ['maxLevel'],
    relaxLabel: trained.length
      ? 'Show every weapon, including ones you are not trained in'
      : 'Show items above your level',
    note: specific && trained.length
      ? `Your class is also proficient with ${specific}, which the catalogue records`
        + ' by name rather than by category. Tick the box if what you want is not here.'
      : null,
    filter: {
      kind: 'equipment', itemType: 'weapon', maxLevel: level, categories: trained,
    },
  };
};

/**
 * Two panels, in the order a character is dressed: what is on them, then what
 * is in the bag. `host` is the wrapper both live in, so the page hands this
 * file one element.
 */
export function renderEquipment(host, { state, store, picker }) {
  const { derived, build } = state;
  if (!derived || !build) { host.replaceChildren(); return; }

  const equipment = build.equipment ?? {};
  const sheet = derived.sheet ?? {};
  const items = derived.items ?? {};
  const context = {
    store, picker, derived, items, sheet,
    level: derived.level ?? 1,
    proficiencies: derived.proficiencies ?? null,
  };

  host.replaceChildren(
    panel('equipment-heading', 'Worn and wielded', wieldedCount(sheet),
      armorRow(equipment.armor ?? null, context),
      shieldRow(equipment.shield ?? null, context),
      ...(equipment.weapons ?? []).map((entry, index) => weaponRow(entry, index, context)),
      addRow('Add a weapon', () => store.update((next) => {
        next.equipment ??= {};
        next.equipment.weapons = [...(next.equipment.weapons ?? []), { id: null }];
      }))),

    panel('carried-heading', 'Carried', bulkText(sheet.bulk?.tenths ?? 0),
      ...(equipment.gear ?? []).map((entry, index) => gearRow(entry, index, context)),
      addRow('Add an item', () => store.update((next) => {
        next.equipment ??= {};
        next.equipment.gear = [...(next.equipment.gear ?? []), { id: null, quantity: 1 }];
      })),
      coinRow(build.coins ?? {}, context),
      bulkRow(sheet.bulk ?? null)),
  );
}

// --- the shapes every row is made of --------------------------------------

/** One card: a heading, something short on the right, and a list of rows. */
function panel(headingId, title, aside, ...rows) {
  return el('section', { class: 'level', 'aria-labelledby': headingId },
    el('header', { class: 'level__head' },
      el('h3', { class: 'level__title', id: headingId }, title),
      el('span', { class: 'level__open level__open--done' }, aside)),
    el('div', { class: 'level__slots' }, ...rows));
}

const wieldedCount = (sheet) => {
  const strikes = (sheet.strikes ?? []).length;
  return strikes ? `${strikes} ${strikes === 1 ? 'strike' : 'strikes'}` : 'No weapons';
};

/** The label-and-control shell the timeline uses, reused here. */
function row(label, control, hint = null) {
  return el('div', { class: 'slot-row' },
    el('div', { class: 'slot-row__label' }, label),
    el('div', { class: 'slot-row__control' },
      control,
      hint ? el('p', { class: 'faint slot-row__hint' }, hint) : null));
}

const addRow = (label, onclick) => row('',
  el('button', { class: 'btn', type: 'button', onclick, html: `${icon('plus')}<span>${label}</span>` }));

/** The button that opens the picker, and what it currently says. */
function choice(slot, { id, label, value, broken = false, picker }) {
  return el('button', {
    class: `slot-choice${id ? '' : ' slot-choice--empty'}${broken ? ' slot-choice--broken' : ''}`,
    type: 'button',
    'aria-label': `${label}: ${value}`,
    onclick: () => picker.open(slot, id ?? null),
  },
  el('span', { class: 'slot-choice__value' }, value),
  el('span', { class: 'slot-choice__hint', html: icon('chevron') }));
}

const removeButton = (label, onclick) => el('button', {
  class: 'btn btn--icon btn--quiet', type: 'button',
  html: `${icon('x')}<span class="sr-only">${label}</span>`,
  onclick,
});

function runeSelect(label, options, value, onChange) {
  return el('select', {
    class: 'input input--compact',
    'aria-label': label,
    onchange: (event) => onChange(Number(event.target.value)),
  }, ...options.map(([option, text]) => el('option', {
    value: String(option), selected: Number(value) === Number(option),
  }, text)));
}

/**
 * What is written where a catalogue name would be.
 *
 * Four states worth telling apart, because three of them look like a bug when
 * they are not: nothing chosen, something described by hand, something chosen,
 * and something chosen whose entry has since gone from the catalogue.
 */
function choiceText(entry, record, empty) {
  if (entry?.id && !record) return `${entry.id} — not in the catalogue`;
  if (record) return record.name;
  if (entry?.custom) return 'Described below';
  return empty;
}

const recordFor = (entry, items) => (entry?.id ? items[entry.id] ?? null : null);

// --- describing an item yourself ------------------------------------------

/** A small labelled control, four or five to a line. */
const field = (id, label, control) => el('label', { class: 'micro', for: id },
  el('span', { class: 'micro__label' }, label), control);

const numberField = (id, label, value, { min = null, max = null, step = 1, placeholder = '' }, onChange) =>
  field(id, label, el('input', {
    class: 'input input--number', type: 'number', id, step: String(step),
    min: min === null ? null : String(min),
    max: max === null ? null : String(max),
    placeholder,
    value: value === null || value === undefined ? '' : String(value),
    'aria-label': label,
    oninput: debounce((event) => onChange(event.target.value), 400),
  }));

const selectField = (id, label, options, value, onChange, format = titleCase) =>
  field(id, label, el('select', {
    class: 'input input--compact', id, 'aria-label': label,
    onchange: (event) => onChange(event.target.value),
  }, ...options.map((option) => el('option', {
    value: option, selected: String(value ?? '') === option,
  }, format(option)))));

const textField = (id, label, value, placeholder, onChange) => field(id, label, el('input', {
  class: 'input', type: 'text', id, placeholder, value: value ?? '', 'aria-label': label,
  oninput: debounce((event) => onChange(event.target.value), 400),
}));

/**
 * The block of fields that stands in for a catalogue record.
 *
 * Shown only once somebody asks for it, and hidden -- but not forgotten -- the
 * moment a catalogue item is chosen, so clearing that choice brings back what
 * they typed rather than an empty form.
 */
function described(entry, { key, write, fields }) {
  if (entry?.id || !entry?.custom) return null;
  const set = (name) => (value) => write((target) => {
    target.custom ??= {};
    target.custom[name] = value;
  });
  return el('div', { class: 'custom' },
    el('div', { class: 'custom__fields' }, ...fields(entry.custom ?? {}, set, key)),
    el('button', {
      class: 'btn btn--quiet custom__drop', type: 'button',
      onclick: () => write((target) => { delete target.custom; }),
    }, 'Use the catalogue instead'));
}

const describeButton = (label, write) => el('button', {
  class: 'btn btn--quiet', type: 'button',
  onclick: () => write((target) => { target.custom ??= {}; }),
}, label);

const bulkField = (key, custom, set) => numberField(`${key}-bulk`, 'Bulk', custom.bulk,
  { min: 0, step: 0.1, placeholder: '0' }, (value) => set('bulk')(value));

// --- worn and wielded -----------------------------------------------------

function armorRow(armor, { store, picker, derived, items, level }) {
  const ac = derived.sheet?.ac ?? {};
  const write = (mutate) => store.update((next) => {
    next.equipment ??= {};
    next.equipment.armor ??= {};
    mutate(next.equipment.armor);
  });
  const record = recordFor(armor, items);

  return row('Armour',
    el('div', {},
      el('div', { class: 'equip-row' },
        choice(ARMOR_SLOT(level), {
          picker,
          id: armor?.id,
          label: 'Armour',
          broken: Boolean(armor?.id && !record),
          value: choiceText(armor, record, 'Unarmoured'),
        }),
        runeSelect('Armour potency rune', POTENCY.map((n) => [n, n ? `+${n}` : 'No potency']),
          armor?.potency ?? 0, (value) => write((a) => { a.potency = value; })),
        armor?.id || armor?.custom
          ? removeButton('Take off this armour',
            () => store.update((next) => { if (next.equipment) next.equipment.armor = null; }))
          : describeButton('Describe your own', write)),

      described(armor, {
        key: 'custom-armor',
        write,
        fields: (custom, set, key) => [
          textField(`${key}-name`, 'Name', custom.name, 'Scale of the Old Guard', set('name')),
          selectField(`${key}-category`, 'Category', ARMOR_CATEGORIES, custom.category ?? 'light', set('category')),
          numberField(`${key}-ac`, 'AC bonus', custom.acBonus, { min: 0, max: 10 }, set('acBonus')),
          numberField(`${key}-dex`, 'Dex cap', custom.dexCap, { min: 0, max: 10, placeholder: 'None' }, set('dexCap')),
          numberField(`${key}-check`, 'Check penalty', custom.checkPenalty, { min: -10, max: 0 }, set('checkPenalty')),
          numberField(`${key}-speed`, 'Speed penalty', custom.speedPenalty, { min: -30, max: 0, step: 5 }, set('speedPenalty')),
          numberField(`${key}-str`, 'Strength', custom.strength, { min: -5, max: 10, placeholder: 'None' }, set('strength')),
          bulkField(key, custom, set),
        ],
      })),

    // What the choice is currently worth, from the server's own derivation.
    `Armour Class proficiency ${titleCase(ac.rank ?? 'untrained')}`
      + (ac.itemBonus ? `, item bonus +${ac.itemBonus}` : '')
      + (ac.dexCap !== null && ac.dexCap !== undefined ? `, Dexterity capped at +${ac.dexCap}` : ''));
}

/**
 * A shield.
 *
 * Its bonus is not added to Armour Class, and the hint says so: a shield is
 * worth its +2 only on the round you Raise it, and a sheet that quietly
 * included it would be wrong about your AC most of the time. Hardness and Hit
 * Points are here because they are what the table asks for when somebody
 * Shield Blocks.
 */
function shieldRow(shield, { store, picker, derived, items, level }) {
  const write = (mutate) => store.update((next) => {
    next.equipment ??= {};
    next.equipment.shield ??= {};
    mutate(next.equipment.shield);
  });
  const record = recordFor(shield, items);
  const derivedShield = derived.sheet?.shield ?? null;

  const numbers = derivedShield && !(shield?.id && !record)
    ? [
      derivedShield.bonus ? `+${derivedShield.bonus} AC while raised` : null,
      derivedShield.hardness ? `Hardness ${derivedShield.hardness}` : null,
      derivedShield.hp ? `HP ${derivedShield.hp}, breaks at ${derivedShield.breakThreshold}` : null,
    ].filter(Boolean).join(' · ')
    : '';
  const hint = numbers
    ? `${numbers}. Tick "Raised" on your sheet to add it to your Armour Class.`
    : 'A shield is worth its bonus only on the round you Raise it, so it is not in your Armour Class here.';

  return row('Shield',
    el('div', {},
      el('div', { class: 'equip-row' },
        choice(SHIELD_SLOT(level), {
          picker,
          id: shield?.id,
          label: 'Shield',
          broken: Boolean(shield?.id && !record),
          value: choiceText(shield, record, 'None'),
        }),
        shield?.id || shield?.custom
          ? removeButton('Put away this shield',
            () => store.update((next) => { if (next.equipment) next.equipment.shield = null; }))
          : describeButton('Describe your own', write)),

      described(shield, {
        key: 'custom-shield',
        write,
        fields: (custom, set, key) => [
          textField(`${key}-name`, 'Name', custom.name, 'Door of the tavern', set('name')),
          numberField(`${key}-ac`, 'AC bonus', custom.acBonus, { min: 0, max: 6 }, set('acBonus')),
          numberField(`${key}-hardness`, 'Hardness', custom.hardness, { min: 0, max: 40 }, set('hardness')),
          numberField(`${key}-hp`, 'Hit points', custom.hp, { min: 0, max: 200 }, set('hp')),
          bulkField(key, custom, set),
        ],
      })),
    hint);
}

function weaponRow(entry, index, { store, picker, items, sheet, level, proficiencies }) {
  const write = (mutate) => store.update((next) => {
    const list = [...(next.equipment?.weapons ?? [])];
    list[index] = { ...(list[index] ?? {}) };
    mutate(list[index]);
    next.equipment ??= {};
    next.equipment.weapons = list;
  });

  const slot = {
    ...WEAPON_SLOT(level, proficiencies), id: `weapon-${index}`, index, kind: 'weapon',
  };
  const record = recordFor(entry, items);
  const strike = (sheet.strikes ?? [])[index] ?? null;

  /**
   * The weapon on one line and everything done to it on the next. Four
   * controls abreast fit the page and not the column, and the one that got
   * squeezed was the only one whose text nobody can guess: "Longs…".
   */
  return row(`Weapon ${index + 1}`,
    el('div', {},
      el('div', { class: 'equip-row' },
        choice(slot, {
          picker,
          id: entry?.id,
          label: `Weapon ${index + 1}`,
          broken: Boolean(entry?.id && !record),
          value: choiceText(entry, record, 'Choose…'),
        }),
        entry?.id || entry?.custom ? null : describeButton('Describe your own', write),
        removeButton(`Remove weapon ${index + 1}`, () => store.update((next) => {
          next.equipment.weapons = (next.equipment?.weapons ?? []).filter((_, i) => i !== index);
        }))),

      /**
       * The name is the player's, always. Left empty it is built from the base
       * weapon and its runes; filled in it is whatever they typed, and the
       * rules underneath go on working.
       */
      el('div', { class: 'equip-row' },
        runeSelect(`Potency rune on weapon ${index + 1}`,
          POTENCY.map((n) => [n, n ? `+${n}` : 'No potency']),
          entry?.potency ?? 0, (value) => write((w) => { w.potency = value; })),
        runeSelect(`Striking rune on weapon ${index + 1}`, STRIKING, entry?.striking ?? 0,
          (value) => write((w) => { w.striking = value; })),
        el('input', {
          class: 'input', type: 'text', value: entry?.name ?? '',
          placeholder: strike?.name ?? 'Call it something else (optional)',
          'aria-label': `Name for weapon ${index + 1}`,
          oninput: debounce((event) => {
            const value = event.target.value;
            write((w) => { w.name = value || undefined; });
          }, 400),
        })),

      described(entry, {
        key: `custom-weapon-${index}`,
        write,
        fields: (custom, set, key) => [
          textField(`${key}-name`, 'Name', custom.name, 'The axe from the barrow', set('name')),
          selectField(`${key}-category`, 'Proficiency', WEAPON_CATEGORIES, custom.category ?? 'simple', set('category')),
          selectField(`${key}-die`, 'Damage die', DICE, custom.die ?? 'd6', set('die'), (die) => die),
          selectField(`${key}-type`, 'Damage type', DAMAGE_TYPES, custom.damageType ?? 'bludgeoning', set('damageType')),
          numberField(`${key}-range`, 'Range in feet', custom.range, { min: 0, max: 1000, step: 5, placeholder: 'Melee' }, set('range')),
          textField(`${key}-traits`, 'Traits', custom.traits, 'finesse, agile', set('traits')),
          bulkField(key, custom, set),
        ],
      })),

    strike && strike.damage
      ? `Attack ${strike.mod >= 0 ? '+' : ''}${strike.mod}, damage ${strike.damage} ${strike.damageType}`
        + (strike.traitsText ? ` — ${strike.traitsText}` : '')
      : null);
}

// --- carried --------------------------------------------------------------

/**
 * One line of the bag.
 *
 * A count, because "47 arrows" is one line and forty-seven is not, and a name
 * that overrides the catalogue's for the same reason a weapon's does. Nothing
 * from the catalogue is required: the duke's letter is a real thing to be
 * carrying and is in no book.
 */
function gearRow(entry, index, { store, picker, derived, items, level }) {
  const write = (mutate) => store.update((next) => {
    const list = [...(next.equipment?.gear ?? [])];
    list[index] = { ...(list[index] ?? {}) };
    mutate(list[index]);
    next.equipment ??= {};
    next.equipment.gear = list;
  });

  const slot = { ...GEAR_SLOT(level), id: `gear-${index}`, index, kind: 'gear' };
  const record = recordFor(entry, items);
  const carried = (derived.sheet?.gear ?? [])[index] ?? null;

  const detail = [
    record?.level ? `Level ${record.level}` : null,
    record ? priceText(record.price) : null,
    carried && carried.bulk
      ? `${bulkText(carried.bulk * carried.quantity)} carried`
      : null,
  ].filter(Boolean).join(' · ');

  return row(`Item ${index + 1}`,
    el('div', {},
      el('div', { class: 'equip-row' },
        choice(slot, {
          picker,
          id: entry?.id,
          label: `Item ${index + 1}`,
          broken: Boolean(entry?.id && !record),
          value: choiceText(entry, record, 'Choose from the catalogue…'),
        }),
        el('input', {
          class: 'input input--number', type: 'number', min: '1', step: '1',
          id: `gear-quantity-${index}`,
          value: String(entry?.quantity ?? 1),
          'aria-label': `How many of item ${index + 1}`,
          oninput: debounce((event) => {
            const value = Math.max(1, Math.trunc(Number(event.target.value) || 1));
            write((g) => { g.quantity = value; });
          }, 400),
        }),
        removeButton(`Remove item ${index + 1}`, () => store.update((next) => {
          next.equipment.gear = (next.equipment?.gear ?? []).filter((_, i) => i !== index);
        }))),

      el('div', { class: 'equip-row' },
        el('input', {
          class: 'input', type: 'text', value: entry?.name ?? '',
          placeholder: record?.name ? 'Call it something else (optional)' : 'Or just write what it is',
          'aria-label': `Name for item ${index + 1}`,
          oninput: debounce((event) => {
            const value = event.target.value;
            write((g) => { g.name = value || undefined; });
          }, 400),
        }),
        entry?.id || entry?.custom ? null : describeButton('Give it a Bulk', write)),

      described(entry, {
        key: `custom-gear-${index}`,
        write,
        fields: (custom, set, key) => [
          textField(`${key}-name`, 'Name', custom.name, 'The duke’s letter', set('name')),
          bulkField(key, custom, set),
        ],
      })),
    detail || null);
}

/**
 * Money.
 *
 * Four denominations rather than one gold field, because a party that has just
 * been paid in silver has to write it down somewhere, and a builder that only
 * understood gold would make them do the conversion in their head every time.
 * The total is shown in gold, which is how everyone talks about it.
 */
function coinRow(coins, { store }) {
  const value = coinValue(coins);
  const write = (key, next) => store.update((build) => {
    build.coins ??= {};
    build.coins[key] = next;
  });

  return row('Coins',
    el('div', { class: 'custom__fields' }, ...COINS.map(([key, label]) => numberField(
      `coins-${key}`, `${label} (${key})`, coins?.[key] ?? 0, { min: 0 },
      (raw) => write(key, Math.max(0, Math.trunc(Number(raw) || 0))),
    ))),
    value ? `Worth ${round(value)} gp altogether.` : null);
}

const round = (value) => String(Math.round(value * 100) / 100);

/**
 * What it all weighs.
 *
 * Advisory, like every other problem this page reports: being over the limit is
 * something a character can choose, and the builder says so rather than
 * refusing to record it.
 */
function bulkRow(bulk) {
  if (!bulk) return null;
  let state = `Encumbered above ${bulk.encumberedAt}, maximum ${bulk.maxAt}.`;
  if (bulk.overloaded) state = `Over the maximum of ${bulk.maxAt}. Nothing more can be lifted.`;
  else if (bulk.encumbered) {
    state = `Encumbered: clumsy 1 and 10 feet slower until this is ${bulk.encumberedAt} or less.`;
  }

  return row('Bulk',
    el('p', { class: `bulk${bulk.encumbered ? ' bulk--over' : ''}` },
      el('strong', {}, bulk.text),
      el('span', { class: 'faint' }, state)),
    'Worn armour counts one less than its printed Bulk, and a thousand coins count as one.');
}
