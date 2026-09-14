/**
 * Armour and weapons.
 *
 * Real equipment records from the pinned upstream, because the whole point of
 * this module is that `dexCap`, `finesse` and `propulsive` are fields rather
 * than inferences -- and a hand-written fixture would only prove the code
 * agrees with the fixture. The expected numbers are worked from Player Core.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  armorClassFrom, attackAttribute, carriedTenths, customArmor, customWeapon,
  damageAttribute, gearRows, recordFor, shieldFrom, strikeFrom,
  weaponSpecializationDamage,
} from '../../src/rules/character/equipment.js';
import { deriveCharacter } from '../../src/rules/character/derive.js';
import { armorClass } from '../../src/rules/proficiency.js';

const OPTIONS = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);
const item = (id) => OPTIONS.equipment[id];
const longsword = item('equipment:longsword');
const rapier = item('equipment:rapier');
const shortbow = item('equipment:shortbow');
const dagger = item('equipment:dagger');
const fullPlate = item('equipment:full-plate');
const leather = item('equipment:leather-armor');

const FIGHTER_PROF = {
  attacks: { unarmed: 'expert', simple: 'expert', martial: 'expert', advanced: 'trained' },
  defenses: { unarmored: 'trained', light: 'trained', medium: 'trained', heavy: 'trained' },
};

describe('armour class', () => {
  it('reads the Dexterity cap off the armour rather than inferring it', () => {
    const ac = armorClassFrom({ armor: fullPlate, proficiencies: FIGHTER_PROF, level: 5 });
    // Full plate caps Dexterity at zero, which is not the same as having no cap.
    expect(ac.dexCap).toBe(0);
    expect(ac.itemBonus).toBe(6);
    expect(ac.rank).toBe('trained');
  });

  it('keeps no-cap and a cap of zero apart', () => {
    expect(armorClassFrom({ armor: leather, proficiencies: FIGHTER_PROF }).dexCap).toBe(4);
    expect(armorClassFrom({ armor: null, proficiencies: FIGHTER_PROF }).dexCap).toBe(null);
  });

  it('uses unarmoured defence when nothing is worn', () => {
    const ac = armorClassFrom({ armor: null, proficiencies: FIGHTER_PROF, level: 5 });
    expect(ac.category).toBe('unarmored');
    expect(ac.rank).toBe('trained');
    expect(ac.itemBonus).toBe(0);
  });

  it('adds a potency rune to the item bonus', () => {
    expect(armorClassFrom({
      armor: fullPlate, worn: { potency: 2 }, proficiencies: FIGHTER_PROF,
    }).itemBonus).toBe(8);
  });

  it('produces an AC the rules engine agrees with', () => {
    const parts = armorClassFrom({ armor: fullPlate, proficiencies: FIGHTER_PROF, level: 5 });
    const total = armorClass({
      dexMod: 3, dexCap: parts.dexCap, rank: parts.rank, level: 5, itemBonus: parts.itemBonus,
    });
    // 10 + 0 capped dex + (5 + 2 trained) + 6 armour = 23
    expect(total.total).toBe(23);
    expect(total.components.dexCapped).toBe(true);
  });
});

describe('which attribute a weapon uses', () => {
  const strong = { str: 4, dex: 1 };
  const nimble = { str: 0, dex: 4 };

  it('attacks with Strength in melee', () => {
    expect(attackAttribute(longsword, strong)).toMatchObject({ key: 'str', mod: 4 });
  });

  it('lets finesse attack with Dexterity when it is higher, and not when it is not', () => {
    expect(attackAttribute(rapier, nimble)).toMatchObject({ key: 'dex', mod: 4 });
    expect(attackAttribute(rapier, strong)).toMatchObject({ key: 'str', mod: 4 });
  });

  it('attacks with Dexterity at range', () => {
    expect(attackAttribute(shortbow, strong)).toMatchObject({ key: 'dex', mod: 1 });
  });

  it('damages with Strength even when it attacked with Dexterity', () => {
    // The rapier is the case the Pathbuilder import warns it cannot judge.
    expect(attackAttribute(rapier, nimble).key).toBe('dex');
    expect(damageAttribute(rapier, nimble)).toBe(0);
    expect(damageAttribute(rapier, strong)).toBe(4);
  });

  it('adds no Strength to a bow', () => {
    expect(damageAttribute(shortbow, strong)).toBe(0);
  });

  it('adds half a positive Strength to a propulsive weapon, and all of a negative one', () => {
    const propulsive = { ...shortbow, traits: ['propulsive'] };
    expect(damageAttribute(propulsive, { str: 5 })).toBe(2);
    expect(damageAttribute(propulsive, { str: -1 })).toBe(-1);
  });

  it('treats a trait with a value as that trait', () => {
    // `thrown-10` is the thrown trait; `finesse` on a dagger is plain.
    expect(attackAttribute(dagger, { str: 0, dex: 3 })).toMatchObject({ key: 'dex' });
  });
});

describe('a strike', () => {
  const mods = { str: 4, dex: 2 };

  it('is level plus proficiency plus attribute', () => {
    const strike = strikeFrom({ id: 'equipment:longsword' }, {
      weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 5,
    });
    // 4 str + (5 + 4 expert) = 13
    expect(strike.mod).toBe(13);
    expect(strike.damage).toBe('1d8+4');
    expect(strike.damageType).toBe('slashing');
  });

  it('counts a striking rune as dice, not as a bonus', () => {
    const strike = strikeFrom({ id: 'equipment:longsword', striking: 1 }, {
      weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 5,
    });
    expect(strike.damage).toBe('2d8+4');
    expect(strikeFrom({ striking: 3 }, { weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 5 })
      .damage).toBe('4d8+4');
  });

  it('adds a potency rune to the attack and names the weapon for it', () => {
    const strike = strikeFrom({ id: 'equipment:longsword', potency: 2, striking: 1 }, {
      weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 5,
    });
    expect(strike.mod).toBe(15);
    expect(strike.name).toBe('+2 striking Longsword');
    expect(strike.baseName).toBe('Longsword');
  });

  it('keeps a name the player gave it', () => {
    const strike = strikeFrom({ id: 'equipment:longsword', name: 'Grandfather’s blade' }, {
      weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 5,
    });
    expect(strike.name).toBe('Grandfather’s blade');
  });

  it('adds weapon specialization from the class’s own proficiency', () => {
    expect(weaponSpecializationDamage('expert', 'standard')).toBe(2);
    expect(weaponSpecializationDamage('master', 'standard')).toBe(3);
    expect(weaponSpecializationDamage('expert', 'greater')).toBe(4);
    expect(weaponSpecializationDamage('expert', null)).toBe(0);

    const strike = strikeFrom({}, {
      weapon: longsword, proficiencies: FIGHTER_PROF, mods, level: 7, specialization: 'standard',
    });
    // 1d8 + 4 str + 2 specialization
    expect(strike.damage).toBe('1d8+6');
  });

  it('still produces a row for a weapon the catalogue has lost', () => {
    const strike = strikeFrom({ id: 'equipment:gone', name: 'Aunt Milla’s hammer' }, {
      weapon: null, proficiencies: FIGHTER_PROF, mods, level: 5,
    });
    expect(strike.name).toBe('Aunt Milla’s hammer');
    expect(strike.damage).toBe('4');
  });

  it('shows its working, as every other statistic on the sheet does', () => {
    const strike = strikeFrom({ potency: 1 }, {
      weapon: rapier, proficiencies: FIGHTER_PROF, mods: { str: 1, dex: 4 }, level: 5,
    });
    expect(strike.components).toMatchObject({
      attribute: 'dex', attributeMod: 4, proficiency: 9, rank: 'expert', potency: 1,
    });
    // Attacks with Dexterity, damages with Strength.
    expect(strike.components.damageFlat).toBe(1);
  });
});

describe('equipment through the whole derivation', () => {
  const dwarf = OPTIONS.ancestry['ancestry:dwarf'];
  const fighter = OPTIONS.class['class:fighter'];
  const context = {
    ancestry: dwarf,
    background: OPTIONS.background['background:acolyte'],
    klass: fighter,
    progression: OPTIONS.progression['class:fighter'],
    items: {
      'equipment:full-plate': fullPlate,
      'equipment:longsword': longsword,
    },
  };

  const build = {
    level: 5,
    attributes: {
      ancestry: ['str'], background: ['wis', 'str'], class: 'str',
      1: ['str', 'dex', 'con', 'cha'], 5: ['str', 'dex', 'con', 'wis'],
    },
    skills: { trained: ['athletics', 'intimidation', 'survival'], increases: {}, lores: [] },
    equipment: {
      armor: { id: 'equipment:full-plate', potency: 1 },
      weapons: [{ id: 'equipment:longsword', potency: 1, striking: 1 }],
    },
  };

  it('puts armour on the sheet where the rules engine will find it', () => {
    const { sheet } = deriveCharacter(build, context);
    expect(sheet.ac).toEqual({ rank: 'trained', dexCap: 0, itemBonus: 7 });
  });

  it('applies the armour’s speed penalty', () => {
    // Dwarf 20, full plate -10.
    expect(deriveCharacter(build, context).sheet.speed).toBe(10);
  });

  it('puts strikes on the sheet in the shape an import produces', () => {
    const { sheet } = deriveCharacter(build, context);
    expect(sheet.strikes).toHaveLength(1);
    expect(sheet.strikes[0]).toMatchObject({
      baseName: 'Longsword', damage: '2d8+4', damageType: 'slashing',
    });
  });

  it('reports an item the catalogue has lost rather than dropping it', () => {
    const { problems, sheet } = deriveCharacter({
      ...build,
      equipment: { armor: { id: 'equipment:nonesuch' }, weapons: [] },
    }, context);
    expect(problems.some((p) => p.kind === 'missing-item')).toBe(true);
    // And falls back to unarmoured rather than to nothing at all.
    expect(sheet.ac.rank).toBe('trained');
    expect(sheet.ac.itemBonus).toBe(0);
  });
});

describe('items that are in no book', () => {
  it('gives a described weapon the same strike a catalogue one would get', () => {
    const described = customWeapon({
      name: 'The axe from the barrow', category: 'martial',
      die: 'd8', damageType: 'slashing', bulk: 1,
    });
    const strike = strikeFrom({ custom: true, striking: 1 }, {
      weapon: described, proficiencies: FIGHTER_PROF, mods: { str: 4 }, level: 5,
    });
    // Expert martial at 5 is +4 rank and +5 level, plus +4 Strength: +13.
    expect(strike.mod).toBe(13);
    expect(strike.damage).toBe('2d8+4');
    expect(strike.baseName).toBe('The axe from the barrow');
  });

  it('reads finesse off a described weapon, because it is a trait like any other', () => {
    const described = customWeapon({ name: 'Duelling pin', traits: 'Finesse, Agile' });
    expect(described.traits).toEqual(['finesse', 'agile']);
    expect(attackAttribute(described, { str: 1, dex: 4 })).toMatchObject({ key: 'dex', mod: 4 });
  });

  /**
   * The build document is written by the player's own browser, which is trusted
   * to be theirs and not to be well-behaved. Everything below would otherwise
   * reach the arithmetic and come out as a sheet full of NaN.
   */
  it('refuses a die, a category or a damage type the rules have no meaning for', () => {
    const nonsense = customWeapon({
      die: 'd97', category: 'legendary', damageType: 'emotional', range: 'far',
    });
    expect(nonsense.damage.die).toBe('d6');
    expect(nonsense.category).toBe('simple');
    expect(nonsense.damage.type).toBe('bludgeoning');
    expect(nonsense.range).toBe(null);
  });

  it('clamps described armour to numbers armour can have', () => {
    const armor = customArmor({ acBonus: 99, dexCap: '', checkPenalty: 5, bulk: -3 });
    expect(armor.acBonus).toBe(10);
    // An empty cap is no cap, which is not a cap of zero.
    expect(armor.dexCap).toBe(null);
    expect(armor.checkPenalty).toBe(0);
    expect(armor.bulk).toBe(0);
    expect(customArmor({ dexCap: 0 }).dexCap).toBe(0);
  });

  it('is only a record when somebody asked for one', () => {
    expect(recordFor({ id: null }, {})).toBe(null);
    expect(recordFor({ id: 'equipment:longsword' }, { 'equipment:longsword': longsword }))
      .toBe(longsword);
    // A catalogue id wins: the description is kept, and ignored until it does
    // not point at anything any more.
    const both = { id: 'equipment:longsword', custom: { name: 'Mine' } };
    expect(recordFor(both, { 'equipment:longsword': longsword }, customWeapon)).toBe(longsword);
    // An id that no longer resolves is a gap, not a silent fallback.
    expect(recordFor(both, {}, customWeapon)).toBe(null);
  });
});

describe('the bag', () => {
  const items = {
    'equipment:rope': item('equipment:rope'),
    'equipment:half-plate': item('equipment:half-plate'),
    'equipment:steel-shield': item('equipment:steel-shield'),
    'equipment:longsword': longsword,
  };

  it('multiplies a line out without multiplying the Bulk into it', () => {
    const [rope] = gearRows([{ id: 'equipment:rope', quantity: 3 }], items);
    expect(rope).toMatchObject({ name: 'Rope', quantity: 3, bulk: 1 });
  });

  it('takes a line with no catalogue item at all', () => {
    const [letter] = gearRows([{ name: "The duke's letter" }], {});
    expect(letter).toMatchObject({ name: "The duke's letter", quantity: 1, bulk: 0, missing: false });
  });

  it('marks an item whose entry has gone rather than dropping the line', () => {
    const [gone] = gearRows([{ id: 'equipment:nonesuch', quantity: 2 }], items);
    expect(gone.missing).toBe(true);
    expect(gone.quantity).toBe(2);
  });

  it('adds up everything carried, with the worn armour counting one less', () => {
    const total = carriedTenths({
      armor: { id: 'equipment:half-plate' },
      shield: { id: 'equipment:steel-shield' },
      weapons: [{ id: 'equipment:longsword' }],
      gear: [{ id: 'equipment:rope', quantity: 2 }],
      coins: { gp: 43 },
      items,
    });
    // Half plate 3, worn as 2. Shield 1, longsword 1, two ropes at L. 43 coins
    // weigh nothing.
    expect(total).toBe(20 + 10 + 10 + 2);
  });

  it('counts a described item by the Bulk it was described with', () => {
    const total = carriedTenths({
      gear: [{ custom: { name: 'Iron coffer', bulk: 2 }, quantity: 2 }],
      items: {},
    });
    expect(total).toBe(40);
  });
});

describe('a shield', () => {
  const steel = item('equipment:steel-shield');

  it('lands on the fields the sheet already had for one', () => {
    const shield = shieldFrom({ id: 'equipment:steel-shield' }, steel);
    expect(shield).toMatchObject({ name: 'Steel Shield', bonus: 2, hardness: 5, hp: 20 });
    // Raising it is the player's, at the table. Nothing here says anything
    // about it, which is what leaves the sheet's toggle theirs to press.
    expect(shield).not.toHaveProperty('raised');
  });

  it('breaks at half its hit points where no threshold is printed', () => {
    expect(shieldFrom({ id: 'x' }, steel).breakThreshold).toBe(10);
    expect(shieldFrom({ id: 'x' }, { ...steel, brokenThreshold: 7 }).breakThreshold).toBe(7);
  });

  it('is nothing at all when there is no shield', () => {
    expect(shieldFrom({}, null)).toBe(null);
  });
});
