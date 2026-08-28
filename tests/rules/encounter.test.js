/**
 * Encounter budget.
 *
 * Party sizes three through seven, because the per-character adjustment is
 * where this math usually goes wrong and the tables it is used at run three to
 * five.
 */
import { describe, expect, it } from 'vitest';

import {
  budgetFor, budgets, creatureCost, difficultyOf, priceEncounter, repriceEncounter,
} from '../../src/rules/encounter.js';

describe('budget for a party of four', () => {
  it.each([
    ['trivial', 40], ['low', 60], ['moderate', 80], ['severe', 120], ['extreme', 160],
  ])('%s is %i XP', (difficulty, xp) => {
    expect(budgetFor(difficulty, 4)).toBe(xp);
  });
});

describe('per-character adjustment', () => {
  // GM Core pg. 75: 10 / 20 / 20 / 30 / 40 per character above or below four.
  const expected = {
    3: { trivial: 30, low: 40, moderate: 60, severe: 90, extreme: 120 },
    4: { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 },
    5: { trivial: 50, low: 80, moderate: 100, severe: 150, extreme: 200 },
    6: { trivial: 60, low: 100, moderate: 120, severe: 180, extreme: 240 },
    7: { trivial: 70, low: 120, moderate: 140, severe: 210, extreme: 280 },
  };

  for (const [size, bands] of Object.entries(expected)) {
    it(`a party of ${size}`, () => {
      for (const [difficulty, xp] of Object.entries(bands)) {
        expect(budgetFor(difficulty, Number(size))).toBe(xp);
      }
    });
  }

  it('returns bands in ascending order', () => {
    for (const size of [3, 4, 5, 6, 7]) {
      const xp = budgets(size).map((b) => b.xp);
      expect([...xp].sort((a, b) => a - b)).toEqual(xp);
    }
  });
});

describe('creature cost', () => {
  it.each([
    [-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40], [1, 60], [2, 80], [3, 120], [4, 160],
  ])('a creature %i levels from the party costs %i XP', (difference, xp) => {
    expect(creatureCost(5 + difference, 5).xp).toBe(xp);
  });

  it('reports creatures outside the table rather than guessing', () => {
    const high = creatureCost(10, 5);
    expect(high.offTable).toBe(true);
    expect(high.xp).toBeNull();
    expect(high.reason).toMatch(/beyond the encounter table/);

    const low = creatureCost(0, 5);
    expect(low.offTable).toBe(true);
    expect(low.xp).toBeNull();
  });
});

describe('difficulty of a total', () => {
  it('treats anything at or below the trivial budget as trivial', () => {
    expect(difficultyOf(0, 4)).toBe('trivial');
    expect(difficultyOf(40, 4)).toBe('trivial');
  });

  it('picks the first band the total fits in', () => {
    expect(difficultyOf(41, 4)).toBe('low');
    expect(difficultyOf(80, 4)).toBe('moderate');
    expect(difficultyOf(120, 4)).toBe('severe');
    expect(difficultyOf(160, 4)).toBe('extreme');
  });

  it('does not pin an over-budget total to extreme', () => {
    expect(difficultyOf(161, 4)).toBe('beyond-extreme');
  });

  it('moves the bands with party size', () => {
    expect(difficultyOf(100, 4)).toBe('severe');
    expect(difficultyOf(100, 5)).toBe('moderate');
  });
});

describe('pricing an encounter', () => {
  const party = { partyLevel: 5, partySize: 4 };

  it('multiplies by count and totals', () => {
    const priced = priceEncounter([{ name: 'Goblin', level: 3, count: 4 }], party);
    expect(priced.totalXp).toBe(80);
    expect(priced.difficulty).toBe('moderate');
    expect(priced.complete).toBe(true);
  });

  it('reports headroom against every band', () => {
    const priced = priceEncounter([{ name: 'Ogre', level: 5 }], party);
    expect(priced.headroom.severe).toBe(80);
    expect(priced.headroom.trivial).toBe(0);
  });

  it('refuses to report a difficulty when a creature is off the table', () => {
    const priced = priceEncounter(
      [{ name: 'Goblin', level: 3 }, { name: 'Dragon', level: 20 }],
      party,
    );
    expect(priced.complete).toBe(false);
    expect(priced.difficulty).toBeNull();
    expect(priced.offTable).toHaveLength(1);
    expect(priced.offTable[0].name).toBe('Dragon');
  });
});

describe('copying an encounter to another campaign', () => {
  const creatures = [{ name: 'Ogre', level: 5, count: 2 }];

  it('flags a difficulty band that moves', () => {
    const moved = repriceEncounter(
      creatures,
      { partyLevel: 5, partySize: 4 },
      { partyLevel: 7, partySize: 4 },
    );
    // Two level 5 creatures cost 40 each against a level 5 party, and 20 each
    // against a level 7 one: 80 XP moderate becomes 40 XP trivial.
    expect(moved.before.difficulty).toBe('moderate');
    expect(moved.after.difficulty).toBe('trivial');
    expect(moved.bandChanged).toBe(true);
  });

  it('is quiet when nothing changes', () => {
    const same = repriceEncounter(
      creatures,
      { partyLevel: 5, partySize: 4 },
      { partyLevel: 5, partySize: 4 },
    );
    expect(same.bandChanged).toBe(false);
    expect(same.xpChanged).toBe(false);
  });

  it('notices a party size change on its own', () => {
    const resized = repriceEncounter(
      [{ name: 'Ogre', level: 5, count: 3 }],
      { partyLevel: 5, partySize: 4 },
      { partyLevel: 5, partySize: 6 },
    );
    // 120 XP is exactly the severe budget for four and exactly the moderate
    // budget for six. The creatures did not change; the party did.
    expect(resized.before.difficulty).toBe('severe');
    expect(resized.after.difficulty).toBe('moderate');
    expect(resized.xpChanged).toBe(false);
  });
});
