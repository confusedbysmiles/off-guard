/**
 * Arbitrary level scaling.
 *
 * This is the one part of the engine that is not rules as written, so the tests
 * are about the shape of the approximation and its edges rather than about
 * matching a printed table.
 */
import { describe, expect, it } from 'vitest';

import { adjustCreature } from '../../src/rules/adjust.js';
import { describeScaling, SCALE_RANGE, scaleCreature } from '../../src/rules/scale.js';
import { loadFixtures } from '../fixtures/index.js';

const { creatures } = loadFixtures();
const troll = creatures.get('forest-troll');

describe('the plan', () => {
  it('labels itself an approximation, every time', () => {
    expect(describeScaling(5, 2).approximate).toBe(true);
    expect(scaleCreature(troll, 2).scaling.approximate).toBe(true);
  });

  it('names its source, so the interface can say where the numbers came from', () => {
    expect(describeScaling(5, 2).source).toBe('fitted');
  });
});

describe('range', () => {
  it.each([-5, 5, 9])('refuses %i steps', (steps) => {
    expect(() => scaleCreature(troll, steps)).toThrow(RangeError);
  });

  it('accepts the whole documented range', () => {
    for (let n = SCALE_RANGE.min; n <= SCALE_RANGE.max; n += 1) {
      expect(() => scaleCreature(troll, n)).not.toThrow();
    }
  });

  it('clamps at the bottom of the published range instead of inventing a level', () => {
    const goblin = creatures.get('goblin-warrior');
    expect(goblin.level).toBe(-1);
    const scaled = scaleCreature(goblin, -2);
    expect(scaled.level).toBe(-1);
    expect(scaled.scaling.clamped).toBe(true);
    expect(scaled.scaling.steps).toBe(0);
    expect(scaled.scaling.requestedSteps).toBe(-2);
    // A clamped scaling must not still move the damage.
    expect(scaled.strikes[0].damage[0].formula).toBe(goblin.strikes[0].damage[0].formula);
  });
});

describe('scaling up', () => {
  const up = scaleCreature(troll, 3);

  it('moves the level', () => {
    expect(up.level).toBe(troll.level + 3);
  });

  it('raises the defences', () => {
    expect(up.ac.value).toBeGreaterThan(troll.ac.value);
    expect(up.hp.max).toBeGreaterThan(troll.hp.max);
    expect(up.saves.fortitude.mod).toBeGreaterThan(troll.saves.fortitude.mod);
  });

  it('scales hit points by ratio, not by difference', () => {
    // A difference would add the same number to a 6 HP goblin as to a 100 HP
    // troll, which is the failure this guards against.
    const goblin = creatures.get('goblin-warrior');
    const goblinUp = scaleCreature(goblin, 4);
    const trollUp = scaleCreature(troll, 4);
    expect(goblinUp.hp.max - goblin.hp.max).toBeLessThan(trollUp.hp.max - troll.hp.max);
  });

  it('adds two damage per level, four for a limited-use ability', () => {
    const dragon = creatures.get('cinder-dragon-ancient');
    const scaled = scaleCreature(dragon, 2);
    const jaws = scaled.strikes.find((s) => s.name === 'Jaws');
    expect(jaws.damage.find((d) => d.type === 'piercing').formula).toBe('4d12+16');
    const breath = scaled.abilities.action.find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('18d6+8 fire damage');
  });

  it('preserves how far a creature sits from the norm', () => {
    // The troll's AC relative to its level should survive the move, so a
    // tough-for-its-level creature stays tough for its level.
    const before = troll.ac.value - describeScaling(troll.level, 0).deltas.ac;
    const after = scaleCreature(troll, 4).ac.value - describeScaling(troll.level, 4).deltas.ac;
    expect(after).toBe(before);
  });
});

describe('scaling down', () => {
  const down = scaleCreature(troll, -2);

  it('lowers the level and the defences', () => {
    expect(down.level).toBe(troll.level - 2);
    expect(down.ac.value).toBeLessThan(troll.ac.value);
    expect(down.hp.max).toBeLessThan(troll.hp.max);
  });

  it('never drives hit points below one', () => {
    const goblin = creatures.get('goblin-warrior');
    expect(scaleCreature({ ...goblin, level: 5, hp: { ...goblin.hp, max: 1 } }, -4).hp.max)
      .toBeGreaterThanOrEqual(1);
  });
});

describe('zero and toggling off', () => {
  it('is a no-op at zero', () => {
    const same = scaleCreature(troll, 0);
    expect(same.level).toBe(troll.level);
    expect(same.scaling ?? null).toBeNull();
  });

  it('leaves the original record untouched', () => {
    const before = JSON.stringify(troll);
    scaleCreature(troll, 4);
    scaleCreature(troll, -4);
    expect(JSON.stringify(troll)).toBe(before);
  });
});

describe('composing with elite and weak', () => {
  it('reads the hit point band from the scaled level, when scaled first', () => {
    // Level 5 troll scaled to 3 then made elite takes the 2-4 band's +15,
    // not the 5-19 band's +20.
    const scaled = scaleCreature({ ...troll, level: 5 }, -2);
    expect(scaled.level).toBe(3);
    const elite = adjustCreature(scaled, 'elite');
    expect(elite.adjustment.hpDelta).toBe(15);
    expect(elite.level).toBe(4);
  });

  it('keeps both markers so the interface can show both badges', () => {
    const both = adjustCreature(scaleCreature(troll, 2), 'elite');
    expect(both.scaling.approximate).toBe(true);
    expect(both.adjustment.kind).toBe('elite');
  });
});
