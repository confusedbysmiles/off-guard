/**
 * Character statistics, against real builds.
 *
 * The three characters below are ordinary Player Core builds worked through by
 * hand; each exercises a different part of the calculator (untrained not adding
 * level, a Dexterity cap, an item bonus, a class DC).
 */
import { describe, expect, it } from 'vitest';

import {
  armorClass, classDc, proficiencyBonus, rankName, statistic,
} from '../../src/rules/proficiency.js';

describe('proficiency', () => {
  it('adds nothing at all when untrained, not even level', () => {
    expect(proficiencyBonus('untrained', 1)).toBe(0);
    expect(proficiencyBonus('untrained', 20)).toBe(0);
  });

  it.each([
    ['trained', 1, 3], ['expert', 1, 5], ['master', 1, 7], ['legendary', 1, 9],
    ['trained', 20, 22], ['expert', 20, 24], ['master', 20, 26], ['legendary', 20, 28],
  ])('%s at level %i is +%i', (rank, level, expected) => {
    expect(proficiencyBonus(rank, level)).toBe(expected);
  });

  it('accepts Foundry’s numeric ranks, for imports', () => {
    expect(rankName(0)).toBe('untrained');
    expect(rankName(4)).toBe('legendary');
    expect(proficiencyBonus(2, 5)).toBe(9);
  });

  it('treats anything unrecognised as untrained rather than throwing', () => {
    expect(rankName('adept')).toBe('untrained');
    expect(proficiencyBonus(undefined, 5)).toBe(0);
  });
});

describe('a level 1 dwarf fighter', () => {
  // Str +4, Dex +2, Con +3, Wis +1. Trained in Athletics, untrained in Arcana.
  // Expert in Fortitude, trained in Reflex and Will. Splint mail: +6, dex cap 1.
  const level = 1;

  it('computes a trained skill', () => {
    expect(statistic({ attributeMod: 4, rank: 'trained', level }).total).toBe(7);
  });

  it('computes an untrained skill without level', () => {
    expect(statistic({ attributeMod: 0, rank: 'untrained', level }).total).toBe(0);
  });

  it('computes saves', () => {
    expect(statistic({ attributeMod: 3, rank: 'expert', level }).total).toBe(8);
    expect(statistic({ attributeMod: 2, rank: 'trained', level }).total).toBe(5);
    expect(statistic({ attributeMod: 1, rank: 'trained', level }).total).toBe(4);
  });

  it('caps Dexterity to the armour', () => {
    const ac = armorClass({ dexMod: 2, dexCap: 1, rank: 'trained', level, itemBonus: 6 });
    expect(ac.total).toBe(20);
    expect(ac.components.dexCapped).toBe(true);
  });

  it('adds a raised shield and not an unraised one', () => {
    const opts = { dexMod: 2, dexCap: 1, rank: 'trained', level, itemBonus: 6, shieldBonus: 2 };
    expect(armorClass({ ...opts, shieldRaised: false }).total).toBe(20);
    expect(armorClass({ ...opts, shieldRaised: true }).total).toBe(22);
  });

  it('computes the class DC', () => {
    expect(classDc({ attributeMod: 4, rank: 'trained', level }).total).toBe(17);
  });
});

describe('a level 5 elf wizard', () => {
  const level = 5;

  it('computes an expert spell DC via the class DC shape', () => {
    // Int +4, expert in spell DC: 10 + 4 + (5 + 4) = 23.
    expect(classDc({ attributeMod: 4, rank: 'expert', level }).total).toBe(23);
  });

  it('computes unarmoured AC', () => {
    // Dex +3, trained in unarmoured, +1 bracers: 10 + 3 + 7 + 1 = 21.
    expect(armorClass({ dexMod: 3, dexCap: null, rank: 'trained', level, itemBonus: 1 }).total)
      .toBe(21);
  });

  it('computes a master skill with an item bonus', () => {
    // Int +4, master in Arcana, +1 item: 4 + (5 + 6) + 1 = 16.
    expect(statistic({ attributeMod: 4, rank: 'master', level, itemBonus: 1 }).total).toBe(16);
  });
});

describe('a level 20 halfling rogue', () => {
  const level = 20;

  it('computes a legendary skill', () => {
    // Dex +7, legendary in Stealth, +3 item: 7 + (20 + 8) + 3 = 38.
    expect(statistic({ attributeMod: 7, rank: 'legendary', level, itemBonus: 3 }).total).toBe(38);
  });

  it('computes AC at the top of the range', () => {
    // Dex +7 capped at 5 by studded leather, legendary, +3 potency: 10+5+28+3 = 46.
    expect(armorClass({
      dexMod: 7, dexCap: 5, rank: 'legendary', level, itemBonus: 3,
    }).total).toBe(46);
  });
});

describe('overrides', () => {
  it('wins outright and says so, keeping the computed value visible', () => {
    const s = statistic({ attributeMod: 4, rank: 'trained', level: 5, override: 99 });
    expect(s.total).toBe(99);
    expect(s.computed).toBe(11);
    expect(s.overridden).toBe(true);
  });

  it('is not triggered by zero, which is a legitimate override', () => {
    const s = statistic({ attributeMod: 4, rank: 'trained', level: 5, override: 0 });
    expect(s.total).toBe(0);
    expect(s.overridden).toBe(true);
  });

  it('is ignored when absent', () => {
    const s = statistic({ attributeMod: 4, rank: 'trained', level: 5, override: null });
    expect(s.total).toBe(11);
    expect(s.overridden).toBe(false);
  });

  it('applies to armour class too', () => {
    const ac = armorClass({ dexMod: 2, rank: 'trained', level: 1, override: 18 });
    expect(ac.total).toBe(18);
    expect(ac.overridden).toBe(true);
    expect(ac.computed).toBe(15);
  });
});

describe('components', () => {
  it('shows its working', () => {
    const s = statistic({ attributeMod: 3, rank: 'expert', level: 7, itemBonus: 1, other: 2 });
    expect(s.total).toBe(17);
    expect(s.components).toEqual({
      attributeMod: 3, proficiency: 11, rank: 'expert', itemBonus: 1, other: 2,
    });
  });
});
