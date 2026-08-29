import { describe, expect, it } from 'vitest';

import {
  DiceError, double, format, halve, parseDice, rollDice,
} from '../../src/rules/dice.js';

/** A random source that walks a fixed list, so every roll below is exact. */
function sequence(values) {
  let i = 0;
  return () => {
    const faces = values[i % values.length];
    i += 1;
    return faces;
  };
}

/** `rolling([20, 3])` on d20s and d6s yields those faces in order. */
function rolling(faces, sides) {
  let i = 0;
  return () => {
    const wanted = faces[i % faces.length];
    const die = Array.isArray(sides) ? sides[i % sides.length] : sides;
    i += 1;
    return (wanted - 1) / die + 1e-9;
  };
}

describe('parsing', () => {
  it('reads a plain die', () => {
    const { terms, text } = parseDice('1d20');
    expect(text).toBe('1d20');
    expect(terms).toEqual([{ kind: 'dice', sign: 1, count: 1, faces: 20, keep: null }]);
  });

  it('defaults an omitted count to one', () => {
    expect(parseDice('d6').text).toBe('1d6');
  });

  it('reads dice and a modifier', () => {
    expect(parseDice('2d6+3').terms).toEqual([
      { kind: 'dice', sign: 1, count: 2, faces: 6, keep: null },
      { kind: 'flat', sign: 1, value: 3 },
    ]);
  });

  it('ignores whitespace', () => {
    expect(parseDice('  2d6 + 3 - 1d4 ').text).toBe('2d6+3-1d4');
  });

  it('keeps a negative term negative', () => {
    const { terms } = parseDice('1d20-2');
    expect(terms[1]).toEqual({ kind: 'flat', sign: -1, value: 2 });
  });

  it('reads the fortune form', () => {
    expect(parseDice('2d20kh1').terms[0].keep).toEqual({ mode: 'highest', count: 1 });
  });

  it('reads the misfortune form', () => {
    expect(parseDice('2d20kl1').terms[0].keep).toEqual({ mode: 'lowest', count: 1 });
  });

  it('round-trips through format', () => {
    for (const text of ['1d20+9', '2d6+1d8+4', '2d20kh1+7', '4d10-3']) {
      expect(format(parseDice(text).terms)).toBe(text);
    }
  });

  it('refuses a die that is not a die', () => {
    expect(() => parseDice('1d7')).toThrow(DiceError);
  });

  it('refuses nonsense', () => {
    for (const text of ['', 'goblin', '2d', 'd', '1d20*2', '1d20/2']) {
      expect(() => parseDice(text), text).toThrow(DiceError);
    }
  });

  it('refuses to keep more dice than were rolled', () => {
    expect(() => parseDice('2d20kh3')).toThrow(DiceError);
  });

  it('refuses a bucket of dice', () => {
    expect(() => parseDice('101d6')).toThrow(DiceError);
  });
});

describe('rolling', () => {
  it('sums the dice and the modifier', () => {
    const result = rollDice('2d6+3', { random: rolling([4, 5], 6) });
    expect(result.terms[0].rolls.map((r) => r.value)).toEqual([4, 5]);
    expect(result.total).toBe(12);
  });

  it('subtracts a negative term', () => {
    expect(rollDice('1d20-2', { random: rolling([15], 20) }).total).toBe(13);
  });

  it('never rolls below one or above the die', () => {
    for (const value of [0, 0.5, 0.999999]) {
      const { terms } = rollDice('1d20', { random: sequence([value]) });
      const [roll] = terms[0].rolls;
      expect(roll.value).toBeGreaterThanOrEqual(1);
      expect(roll.value).toBeLessThanOrEqual(20);
    }
  });

  it('keeps the highest and remembers the one it dropped', () => {
    const result = rollDice('2d20kh1', { random: rolling([3, 18], 20) });
    expect(result.total).toBe(18);
    expect(result.terms[0].rolls).toEqual([
      { value: 3, index: 0, counted: false },
      { value: 18, index: 1, counted: true },
    ]);
  });

  it('keeps the lowest for misfortune', () => {
    expect(rollDice('2d20kl1', { random: rolling([3, 18], 20) }).total).toBe(3);
  });

  it('reports the natural for a single d20', () => {
    expect(rollDice('1d20+9', { random: rolling([20], 20) }).natural).toBe(20);
    expect(rollDice('1d20+9', { random: rolling([1], 20) }).natural).toBe(1);
  });

  it('reports the kept die as the natural under fortune', () => {
    expect(rollDice('2d20kh1+7', { random: rolling([1, 20], 20) }).natural).toBe(20);
  });

  it('has no natural when the expression is not a check', () => {
    expect(rollDice('2d6+3', { random: rolling([4, 5], 6) }).natural).toBeNull();
    expect(rollDice('2d20', { random: rolling([4, 5], 20) }).natural).toBeNull();
  });
});

describe('halving and doubling', () => {
  it('rounds a halved total down', () => {
    expect(halve(13)).toBe(6);
    expect(halve(12)).toBe(6);
    expect(halve(1)).toBe(0);
  });

  it('does not take a halved total below zero', () => {
    expect(halve(-4)).toBe(0);
  });

  it('doubles the total rather than each die', () => {
    // 2d6+3 rolling 4 and 5 is 12; a critical hit is 24, not 4+4+5+5+3 = 21.
    const rolled = rollDice('2d6+3', { random: rolling([4, 5], 6) });
    expect(double(rolled.total)).toBe(24);
  });
});
