/**
 * Armour and weapons.
 *
 * Its own panel rather than a slot in the timeline, because equipment is not a
 * level choice: a character swaps a weapon mid-campaign and the level they did
 * it at is nobody's business.
 *
 * The shape of this panel is the answer to "adding custom items is messy". A
 * weapon here is three separate things -- the base item the rules are about,
 * the runes on it, and whatever the player calls it -- and none of them
 * requires inventing a compendium entry. A `+1 striking longsword` named
 * "Grandfather's blade" is a longsword with two numbers and a label, so the
 * damage dice, the traits and the proficiency all keep working while the sheet
 * still says what the player wanted it to say.
 */
import { el, debounce, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const POTENCY = [0, 1, 2, 3];
const STRIKING = [
  [0, 'No striking rune'], [1, 'Striking'], [2, 'Greater striking'], [3, 'Major striking'],
];

const ARMOR_SLOT = {
  id: 'armor', kind: 'armor', label: 'Armour',
  filter: { kind: 'equipment', itemType: 'armor' },
};
const WEAPON_SLOT = {
  id: 'weapon', kind: 'weapon', label: 'Weapon',
  filter: { kind: 'equipment', itemType: 'weapon' },
};

export function renderEquipment(host, { state, store, picker }) {
  const { derived, build } = state;
  if (!derived || !build) { host.replaceChildren(); return; }

  const equipment = build.equipment ?? {};
  const strikes = derived.sheet?.strikes ?? [];

  const items = derived.items ?? {};
  const nameOf = (id) => items[id]?.name ?? null;

  host.replaceChildren(
    el('header', { class: 'level__head' },
      el('h3', { class: 'level__title', id: 'equipment-heading' }, 'Equipment'),
      el('span', { class: 'level__open level__open--done' },
        strikes.length ? `${strikes.length} ${strikes.length === 1 ? 'strike' : 'strikes'}` : 'No weapons')),

    el('div', { class: 'level__slots' },
      armorRow(equipment.armor ?? null, { store, picker, derived, nameOf }),
      ...(equipment.weapons ?? []).map((entry, index) =>
        weaponRow(entry, index, { store, picker, strike: strikes[index], nameOf })),
      el('div', { class: 'slot-row' },
        el('div', { class: 'slot-row__label' }, ''),
        el('div', { class: 'slot-row__control' },
          el('button', {
            class: 'btn', type: 'button',
            onclick: () => store.update((next) => {
              next.equipment ??= {};
              next.equipment.weapons = [...(next.equipment.weapons ?? []), { id: null }];
            }),
          }, 'Add a weapon')))),
  );
}

function armorRow(armor, { store, picker, derived, nameOf }) {
  const ac = derived.sheet?.ac ?? {};
  const write = (mutate) => store.update((next) => {
    next.equipment ??= {};
    next.equipment.armor ??= {};
    mutate(next.equipment.armor);
  });

  return el('div', { class: 'slot-row' },
    el('div', { class: 'slot-row__label' }, 'Armour'),
    el('div', { class: 'slot-row__control' },
      el('div', { class: 'equip-row' },
        el('button', {
          class: `slot-choice${armor?.id ? '' : ' slot-choice--empty'}`,
          type: 'button',
          'aria-label': `Armour: ${nameOf(armor?.id) ?? (armor?.id ? armor.id : 'none, unarmoured')}`,
          onclick: () => picker.open(ARMOR_SLOT, armor?.id ?? null),
        },
        el('span', { class: 'slot-choice__value' },
          nameOf(armor?.id) ?? (armor?.id ? `${armor.id} — not in the catalogue` : 'Unarmoured')),
        el('span', { class: 'slot-choice__hint', html: icon('chevron') })),
        runeSelect('Potency', POTENCY.map((n) => [n, n ? `+${n}` : 'No potency rune']),
          armor?.potency ?? 0, (value) => write((a) => { a.potency = value; })),
        armor?.id
          ? el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            html: `${icon('x')}<span class="sr-only">Take off this armour</span>`,
            onclick: () => store.update((next) => { if (next.equipment) next.equipment.armor = null; }),
          })
          : null),
      // What the choice is currently worth, from the server's own derivation.
      el('p', { class: 'faint slot-row__hint' },
        `Armour Class proficiency ${titleCase(ac.rank ?? 'untrained')}`
        + (ac.itemBonus ? `, item bonus +${ac.itemBonus}` : '')
        + (ac.dexCap !== null && ac.dexCap !== undefined ? `, Dexterity capped at +${ac.dexCap}` : ''))));
}

function weaponRow(entry, index, { store, picker, strike, nameOf }) {
  const write = (mutate) => store.update((next) => {
    const list = next.equipment?.weapons ?? [];
    mutate(list[index] ?? {});
    next.equipment.weapons = list;
  });

  const slot = { ...WEAPON_SLOT, id: `weapon-${index}`, index };

  return el('div', { class: 'slot-row' },
    el('div', { class: 'slot-row__label' }, `Weapon ${index + 1}`),
    el('div', { class: 'slot-row__control' },
      el('div', { class: 'equip-row' },
        el('button', {
          class: `slot-choice${entry?.id ? '' : ' slot-choice--empty'}`,
          type: 'button',
          'aria-label': `Weapon ${index + 1}: ${strike?.baseName ?? nameOf(entry?.id) ?? 'not yet chosen'}`,
          onclick: () => picker.open(slot, entry?.id ?? null),
        },
        el('span', { class: 'slot-choice__value' },
          strike?.baseName ?? nameOf(entry?.id) ?? 'Choose…'),
        el('span', { class: 'slot-choice__hint', html: icon('chevron') })),
        runeSelect('Potency', POTENCY.map((n) => [n, n ? `+${n}` : 'No potency']),
          entry?.potency ?? 0, (value) => write((w) => { w.potency = value; })),
        runeSelect('Striking', STRIKING, entry?.striking ?? 0,
          (value) => write((w) => { w.striking = value; })),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          html: `${icon('x')}<span class="sr-only">Remove weapon ${index + 1}</span>`,
          onclick: () => store.update((next) => {
            next.equipment.weapons = (next.equipment?.weapons ?? []).filter((_, i) => i !== index);
          }),
        })),

      /**
       * The name is the player's, always. Left empty it is built from the base
       * weapon and its runes; filled in it is whatever they typed, and the
       * rules underneath go on working.
       */
      el('div', { class: 'equip-row' },
        el('input', {
          class: 'input', type: 'text', value: entry?.name ?? '',
          placeholder: strike?.name ?? 'Call it something else (optional)',
          'aria-label': `Name for weapon ${index + 1}`,
          oninput: debounce((event) => {
            const value = event.target.value;
            write((w) => { w.name = value || undefined; });
          }, 400),
        })),

      strike && strike.damage
        ? el('p', { class: 'faint slot-row__hint' },
          `Attack ${strike.mod >= 0 ? '+' : ''}${strike.mod}, damage ${strike.damage} ${strike.damageType}`
          + (strike.traitsText ? ` — ${strike.traitsText}` : ''))
        : null));
}

function runeSelect(label, options, value, onChange) {
  return el('select', {
    class: 'input input--compact',
    'aria-label': label,
    onchange: (event) => onChange(Number(event.target.value)),
  }, ...options.map(([option, text]) => el('option', {
    value: String(option), selected: Number(value) === Number(option),
  }, text)));
}
