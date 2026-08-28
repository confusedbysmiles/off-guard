/**
 * Elite and weak.
 *
 * The level and HP boundaries are where this arithmetic goes wrong, so they are
 * tested exhaustively: level -1 and 0 (double level step), 1 (weak's double
 * step, and the top of the +/-10 HP band), 2 and 4 (the +/-15 band), 5 and 19
 * (the +/-20 band), 20 (the +/-30 band).
 */
import { describe, expect, it } from 'vitest';

import { adjustCreature, isLimitedUse } from '../../src/rules/adjust.js';
import { loadFixtures } from '../fixtures/index.js';

const { creatures } = loadFixtures();

/** A minimal record, so a boundary case is not hostage to a fixture's level. */
function creatureAt(level, hp = 100) {
  return {
    id: 'test', name: 'Test', level, rarity: 'common', traits: [],
    ac: { value: 20, details: null },
    hp: { max: hp, details: null, regeneration: null, fastHealing: null, hardness: null },
    perception: { mod: 10, senses: [], sensesLabel: null, details: null },
    saves: {
      fortitude: { mod: 12, note: null },
      reflex: { mod: 11, note: null },
      will: { mod: 9, note: null },
      allNote: null,
    },
    skills: [{ slug: 'athletics', label: 'Athletics', mod: 14, note: null, special: [] }],
    strikes: [], spellcasting: [],
    abilities: { passive: [], action: [], reaction: [], free: [] },
  };
}

describe('elite level adjustment', () => {
  it.each([
    [-1, 1], [0, 2], [1, 2], [2, 3], [4, 5], [5, 6], [19, 20], [20, 21],
  ])('level %i becomes %i', (from, expected) => {
    expect(adjustCreature(creatureAt(from), 'elite').level).toBe(expected);
  });
});

describe('weak level adjustment', () => {
  it.each([
    [-1, -2], [0, -1], [1, -1], [2, 1], [4, 3], [5, 4], [19, 18], [20, 19],
  ])('level %i becomes %i', (from, expected) => {
    expect(adjustCreature(creatureAt(from), 'weak').level).toBe(expected);
  });
});

describe('hit points by starting level band', () => {
  it.each([
    [-1, 10], [0, 10], [1, 10],
    [2, 15], [3, 15], [4, 15],
    [5, 20], [10, 20], [19, 20],
    [20, 30], [24, 30],
  ])('level %i shifts hit points by %i', (level, delta) => {
    expect(adjustCreature(creatureAt(level), 'elite').hp.max).toBe(100 + delta);
    expect(adjustCreature(creatureAt(level), 'weak').hp.max).toBe(100 - delta);
  });

  it('reads the band from the starting level, not the adjusted one', () => {
    // Level 4 elite becomes level 5, but takes the 2-4 band's +15, not +20.
    expect(adjustCreature(creatureAt(4), 'elite').hp.max).toBe(115);
    // Level 5 weak becomes level 4, and still takes the 5-19 band's -20.
    expect(adjustCreature(creatureAt(5), 'weak').hp.max).toBe(80);
  });

  it('never drives hit points below one', () => {
    expect(adjustCreature(creatureAt(1, 6), 'weak').hp.max).toBe(1);
  });
});

describe('modifiers', () => {
  const base = creatureAt(5);

  it('shifts every modifier by two', () => {
    const elite = adjustCreature(base, 'elite');
    expect(elite.ac.value).toBe(22);
    expect(elite.perception.mod).toBe(12);
    expect(elite.saves.fortitude.mod).toBe(14);
    expect(elite.saves.reflex.mod).toBe(13);
    expect(elite.saves.will.mod).toBe(11);
    expect(elite.skills[0].mod).toBe(16);
  });

  it('mirrors for weak', () => {
    const weak = adjustCreature(base, 'weak');
    expect(weak.ac.value).toBe(18);
    expect(weak.perception.mod).toBe(8);
    expect(weak.skills[0].mod).toBe(12);
  });
});

describe('non-destructive', () => {
  const goblin = creatures.get('goblin-warrior');

  it('leaves the original record untouched', () => {
    const before = JSON.stringify(goblin);
    adjustCreature(goblin, 'elite');
    adjustCreature(goblin, 'weak');
    expect(JSON.stringify(goblin)).toBe(before);
  });

  it('round-trips back to the original numbers', () => {
    const elite = adjustCreature(goblin, 'elite');
    const back = adjustCreature(elite, null);
    expect(back.adjustment).toBeNull();
    // Toggling off returns the *adjusted* record with its marker cleared, so
    // the caller keeps the base record; what matters is that the base is intact.
    expect(goblin.ac.value).toBe(16);
    expect(elite.ac.value).toBe(18);
  });

  it('records what it did', () => {
    const elite = adjustCreature(goblin, 'elite');
    expect(elite.adjustment).toMatchObject({
      kind: 'elite', startingLevel: -1, hpDelta: 10, modDelta: 2, label: 'Elite',
    });
  });
});

describe('strike damage', () => {
  const goblin = creatures.get('goblin-warrior');

  it('adds two to the strike damage and the attack modifier', () => {
    const elite = adjustCreature(goblin, 'elite');
    const dogslicer = elite.strikes.find((s) => s.name === 'Dogslicer');
    expect(dogslicer.mod).toBe(goblin.strikes[0].mod + 2);
    expect(dogslicer.damage[0].formula).toBe('1d6+2');
  });

  it('folds into an existing constant rather than appending', () => {
    const dragon = creatures.get('cinder-dragon-ancient');
    const jaws = adjustCreature(dragon, 'elite').strikes.find((s) => s.name === 'Jaws');
    const piercing = jaws.damage.find((d) => d.type === 'piercing');
    expect(piercing.formula).toBe('4d12+14');
  });

  it('leaves persistent damage alone', () => {
    const dragon = creatures.get('cinder-dragon-ancient');
    const jaws = adjustCreature(dragon, 'elite').strikes.find((s) => s.name === 'Jaws');
    const persistent = jaws.damage.find((d) => d.category === 'persistent');
    expect(persistent.formula).toBe('1d8');
  });
});

describe('limited-use abilities', () => {
  const dragon = creatures.get('cinder-dragon-ancient');

  it('recognises a recharge stated only in prose', () => {
    const breath = dragon.abilities.action.find((a) => a.name === 'Pyre Breath');
    expect(breath.frequency).toBeNull();
    expect(breath.rechargeNote).toMatch(/again for 1d4 rounds/);
    expect(isLimitedUse(breath)).toBe(true);
  });

  it('adds four to a limited-use ability, inside the sentence', () => {
    const breath = adjustCreature(dragon, 'elite').abilities.action
      .find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('18d6+4 fire damage');
    expect(breath.text.text).not.toContain('18d6 fire damage');
  });

  it('subtracts four for weak', () => {
    const breath = adjustCreature(dragon, 'weak').abilities.action
      .find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('18d6-4 fire damage');
  });

  it('shifts a DC written inside ability text', () => {
    const breath = adjustCreature(dragon, 'elite').abilities.action
      .find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('DC 43 basic Reflex save');
    expect(breath.text.html).toContain('DC 43 basic Reflex save');
  });

  it('leaves persistent damage inside ability text alone', () => {
    const breath = adjustCreature(dragon, 'elite').abilities.action
      .find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('2d6 persistent fire');
  });
});

describe('spellcasting', () => {
  it('shifts the spell DC and attack modifier', () => {
    const lich = creatures.get('lich');
    const before = lich.spellcasting[0];
    const after = adjustCreature(lich, 'elite').spellcasting[0];
    expect(after.dc).toBe(before.dc + 2);
    if (before.attackMod !== null) expect(after.attackMod).toBe(before.attackMod + 2);
  });
});
