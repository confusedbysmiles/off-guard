import { describe, expect, it } from 'vitest';

import {
  DC_BY_LEVEL, dcByLevel, dcBySpellRank, degreeOfSuccess, simpleDc,
} from '../../src/rules/dc.js';

describe('level-based DCs', () => {
  // Spot checks against the printed table, GM Core pg. 53.
  it.each([[-1, 13], [0, 14], [1, 15], [5, 20], [10, 27], [15, 34], [20, 40], [25, 50]])(
    'level %i is DC %i', (level, dc) => {
      expect(dcByLevel(level).dc).toBe(dc);
    },
  );

  it('covers the whole printed range with no gaps', () => {
    for (let level = -1; level <= 25; level += 1) {
      expect(DC_BY_LEVEL[level], `level ${level}`).toBeTypeOf('number');
    }
  });

  it('rises monotonically', () => {
    for (let level = 0; level <= 25; level += 1) {
      expect(DC_BY_LEVEL[level]).toBeGreaterThanOrEqual(DC_BY_LEVEL[level - 1]);
    }
  });

  it('applies the rarity adjustment', () => {
    expect(dcByLevel(5, { rarity: 'common' }).dc).toBe(20);
    expect(dcByLevel(5, { rarity: 'uncommon' }).dc).toBe(22);
    expect(dcByLevel(5, { rarity: 'rare' }).dc).toBe(25);
    expect(dcByLevel(5, { rarity: 'unique' }).dc).toBe(30);
  });

  it('applies a difficulty adjustment on top', () => {
    expect(dcByLevel(5, { rarity: 'rare', difficulty: 'hard' }).dc).toBe(27);
    expect(dcByLevel(5, { difficulty: 'very easy' }).dc).toBe(15);
  });

  it('clamps outside the table and says so', () => {
    const high = dcByLevel(40);
    expect(high.clamped).toBe(true);
    expect(high.level).toBe(25);
  });
});

describe('spell rank DCs', () => {
  it.each([[1, 15], [5, 26], [10, 39]])('rank %i is DC %i', (rank, dc) => {
    expect(dcBySpellRank(rank).dc).toBe(dc);
  });

  it('returns null outside the table', () => {
    expect(dcBySpellRank(11)).toBeNull();
  });
});

describe('simple DCs', () => {
  it.each([
    ['untrained', 10], ['trained', 15], ['expert', 20], ['master', 30], ['legendary', 40],
  ])('%s is DC %i', (rank, dc) => {
    expect(simpleDc(rank).dc).toBe(dc);
  });

  it('takes a difficulty adjustment', () => {
    expect(simpleDc('expert', { difficulty: 'hard' }).dc).toBe(22);
  });
});

describe('degree of success', () => {
  it('reads the four degrees off the margin', () => {
    expect(degreeOfSuccess(30, 20)).toBe('critical success');
    expect(degreeOfSuccess(20, 20)).toBe('success');
    expect(degreeOfSuccess(19, 20)).toBe('failure');
    expect(degreeOfSuccess(11, 20)).toBe('failure');
    expect(degreeOfSuccess(10, 20)).toBe('critical failure');
  });

  it('steps up on a natural 20 and down on a natural 1', () => {
    expect(degreeOfSuccess(20, 20, { natural: 20 })).toBe('critical success');
    expect(degreeOfSuccess(19, 20, { natural: 20 })).toBe('success');
    expect(degreeOfSuccess(20, 20, { natural: 1 })).toBe('failure');
    expect(degreeOfSuccess(30, 20, { natural: 1 })).toBe('success');
  });

  it('cannot step beyond the ends', () => {
    expect(degreeOfSuccess(40, 20, { natural: 20 })).toBe('critical success');
    expect(degreeOfSuccess(1, 20, { natural: 1 })).toBe('critical failure');
  });
});
