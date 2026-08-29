/**
 * Conditions, damage, dying and the turn boundary.
 *
 * The behaviour under test is as much about what the tracker refuses to decide
 * as about what it computes.
 */
import { describe, expect, it } from 'vitest';

import {
  addCondition, applyAutomatic, applyDamage, CONDITIONS, conditionValue, DYING_MAXIMUM,
  endOfTurn, isValued, PERSISTENT_FLAT_DC, recoverFromDying, removeCondition,
  setConditionValue, startOfTurn,
} from '../../src/rules/conditions.js';

describe('the condition list', () => {
  it('came from the pinned checkout with its text intact', () => {
    expect(Object.keys(CONDITIONS).length).toBeGreaterThan(35);
    expect(CONDITIONS.frightened.text).toMatch(/status penalty/);
    expect(CONDITIONS.frightened.source).toMatch(/Player Core/);
  });

  it('knows which conditions carry a value', () => {
    expect(isValued('frightened')).toBe(true);
    expect(isValued('dying')).toBe(true);
    expect(isValued('prone')).toBe(false);
    expect(isValued('blinded')).toBe(false);
  });
});

describe('adding conditions', () => {
  it('adds a valueless condition once', () => {
    let conditions = addCondition([], 'prone');
    conditions = addCondition(conditions, 'prone');
    expect(conditions).toEqual([{ slug: 'prone', value: null }]);
  });

  it('keeps the higher value rather than stacking', () => {
    let conditions = addCondition([], 'frightened', 2);
    conditions = addCondition(conditions, 'frightened', 1);
    expect(conditionValue(conditions, 'frightened')).toBe(2);
    conditions = addCondition(conditions, 'frightened', 3);
    expect(conditionValue(conditions, 'frightened')).toBe(3);
  });

  it('removes a condition that the new one overrides', () => {
    // Blinded overrides dazzled in the printed data.
    const overridden = CONDITIONS.blinded.overrides;
    expect(overridden).toContain('dazzled');
    const conditions = addCondition(addCondition([], 'dazzled'), 'blinded');
    expect(conditions.map((c) => c.slug)).toEqual(['blinded']);
  });

  it('ignores a condition that does not exist', () => {
    expect(addCondition([], 'bewildered')).toEqual([]);
  });

  it('removes a valued condition when its value reaches zero', () => {
    const conditions = setConditionValue([{ slug: 'frightened', value: 1 }], 'frightened', 0);
    expect(conditions).toEqual([]);
  });
});

describe('the end of a turn', () => {
  it('decreases frightened without asking, because the rule says so outright', () => {
    const { automatic, prompts } = endOfTurn({ conditions: [{ slug: 'frightened', value: 2 }] });
    expect(automatic).toHaveLength(1);
    expect(automatic[0]).toMatchObject({ slug: 'frightened', from: 2, to: 1 });
    expect(automatic[0].because).toMatch(/end of each of your turns/);
    expect(prompts).toHaveLength(0);
  });

  it('removes frightened entirely when it reaches zero', () => {
    const combatant = { conditions: [{ slug: 'frightened', value: 1 }] };
    const { automatic } = endOfTurn(combatant);
    expect(applyAutomatic(combatant.conditions, automatic)).toEqual([]);
  });

  it('asks about persistent damage rather than rolling it', () => {
    const { automatic, prompts } = endOfTurn({
      conditions: [],
      persistentDamage: [{ formula: '2d6', type: 'fire' }],
    });
    expect(automatic).toHaveLength(0);
    expect(prompts[0]).toMatchObject({
      kind: 'persistent-damage', formula: '2d6', flatCheckDc: PERSISTENT_FLAT_DC,
    });
  });

  it('asks about stunned, which depends on actions actually lost', () => {
    const { automatic, prompts } = endOfTurn({ conditions: [{ slug: 'stunned', value: 3 }] });
    expect(automatic).toHaveLength(0);
    expect(prompts[0].kind).toBe('stunned');
    expect(prompts[0].because).toMatch(/actions actually lost/);
  });

  it('leaves alone every condition that keys off a night’s rest', () => {
    for (const slug of ['doomed', 'drained', 'fatigued']) {
      const { automatic, prompts } = endOfTurn({ conditions: [{ slug, value: 2 }] });
      expect(automatic, slug).toHaveLength(0);
      expect(prompts, slug).toHaveLength(0);
    }
  });

  it('does nothing at all for a combatant with no conditions', () => {
    expect(endOfTurn({ conditions: [] })).toEqual({ automatic: [], prompts: [] });
  });
});

describe('the start of a turn', () => {
  it('asks for a recovery check when dying, with the right DC', () => {
    const { prompts } = startOfTurn({ dying: 2 });
    expect(prompts[0]).toMatchObject({ kind: 'recovery-check', dying: 2, dc: 12 });
  });

  it('asks nothing of a conscious combatant', () => {
    expect(startOfTurn({ dying: 0 }).prompts).toHaveLength(0);
  });
});

describe('damage', () => {
  const healthy = { hpCurrent: 40, hpMax: 48, hpTemp: 0, dying: 0, wounded: 0 };

  it('reduces hit points', () => {
    expect(applyDamage(healthy, 10)).toMatchObject({ hpCurrent: 30, dying: 0 });
  });

  it('spends temporary hit points first, and does not heal them back', () => {
    const withTemp = { ...healthy, hpTemp: 6 };
    const hit = applyDamage(withTemp, 10);
    expect(hit).toMatchObject({ hpTemp: 0, hpCurrent: 36 });
    const healed = applyDamage(hit, -20);
    expect(healed.hpTemp).toBe(0);
  });

  it('starts dying at 1 when dropped to zero', () => {
    const result = applyDamage(healthy, 40);
    expect(result).toMatchObject({ hpCurrent: 0, dying: 1 });
    expect(result.notes[0]).toMatch(/dying 1/);
  });

  it('adds the wounded value when dropping to zero', () => {
    const result = applyDamage({ ...healthy, wounded: 2 }, 40);
    expect(result.dying).toBe(3);
  });

  it('increases dying when damaged while already dying', () => {
    const result = applyDamage({ ...healthy, hpCurrent: 0, dying: 1 }, 5);
    expect(result.dying).toBe(2);
    expect(result.hpCurrent).toBe(0);
  });

  it('reports death at dying four', () => {
    const result = applyDamage({ ...healthy, hpCurrent: 0, dying: 3 }, 5);
    expect(result.dying).toBe(DYING_MAXIMUM);
    expect(result.dead).toBe(true);
  });

  it('heals on a negative amount, which is the entry a GM actually types', () => {
    expect(applyDamage({ ...healthy, hpCurrent: 10 }, -15)).toMatchObject({ hpCurrent: 25 });
  });

  it('does not heal past the maximum', () => {
    expect(applyDamage(healthy, -100).hpCurrent).toBe(48);
  });

  it('ends dying when healed above zero, and makes the character wounded', () => {
    // Player Core, Wounded: losing dying by any means -- including being healed
    // rather than recovering -- raises the wounded value.
    const result = applyDamage({ ...healthy, hpCurrent: 0, dying: 2, wounded: 1 }, -10);
    expect(result).toMatchObject({ hpCurrent: 10, dying: 0, wounded: 2 });
    expect(result.notes[0]).toMatch(/now wounded 2/);
  });

  it('makes a character wounded 1 the first time they are healed out of dying', () => {
    const result = applyDamage({ ...healthy, hpCurrent: 0, dying: 1, wounded: 0 }, -5);
    expect(result.wounded).toBe(1);
  });

  it('leaves wounded alone when healing someone who was not dying', () => {
    const result = applyDamage({ ...healthy, hpCurrent: 10, dying: 0, wounded: 2 }, -5);
    expect(result.wounded).toBe(2);
  });

  it('never goes below zero hit points', () => {
    expect(applyDamage(healthy, 500).hpCurrent).toBe(0);
  });
});

describe('recovering', () => {
  it('raises wounded by one each time dying ends', () => {
    expect(recoverFromDying({ wounded: 0 })).toEqual({ dying: 0, wounded: 1 });
    expect(recoverFromDying({ wounded: 2 })).toEqual({ dying: 0, wounded: 3 });
  });
});
