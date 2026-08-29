/**
 * Arbitrary level scaling.
 *
 * Moving a creature between levels is not rules as written -- there is no
 * printed operation for it -- but the numbers the move is built from are the
 * printed GM Core creature-building tables, so most of these tests can check
 * against a column of the book rather than against the shape of a guess.
 */
import { describe, expect, it } from 'vitest';

import { adjustCreature } from '../../src/rules/adjust.js';
import { describeScaling, SCALE_RANGE, scaleCreature } from '../../src/rules/scale.js';
import { CREATURE_BUILDING } from '../../src/rules/tables/creature-scaling.js';
import { loadFixtures } from '../fixtures/index.js';

/** The printed value in one column of one table, e.g. `column('ac', 8, 'high')`. */
const column = (table, level, name) => {
  const { columns, rows } = CREATURE_BUILDING[table];
  return rows[String(level)][columns.indexOf(name)];
};

const { creatures } = loadFixtures();
const troll = creatures.get('forest-troll');

describe('the plan', () => {
  it('labels itself an approximation, every time', () => {
    expect(describeScaling(5, 2).approximate).toBe(true);
    expect(scaleCreature(troll, 2).scaling.approximate).toBe(true);
  });

  it('names its source, so the interface can say where the numbers came from', () => {
    expect(describeScaling(5, 2).source).toBe('GM Core pp. 114–121');
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

  it('clamps at the top, where the printed tables stop', () => {
    // GM Core's tables run to level 24, "the highest-level extreme encounter a
    // party might face", but published creatures go past it.
    const scaled = scaleCreature({ ...troll, level: 23 }, 4);
    expect(scaled.level).toBe(24);
    expect(scaled.scaling.clamped).toBe(true);
    expect(scaled.scaling.steps).toBe(1);
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

  it('moves damage along the column it already sits in, inside ability text too', () => {
    // The ancient cinder dragon is level 19. Its jaws deal 4d12+12, a mean of
    // 38, which the level 19 Strike Damage row puts between moderate (35) and
    // high (42); two levels up those become 38 and 46, so the mean lands on 41
    // and the flat modifier carries the three.
    const dragon = creatures.get('cinder-dragon-ancient');
    expect(dragon.level).toBe(19);
    const scaled = scaleCreature(dragon, 2);
    const jaws = scaled.strikes.find((s) => s.name === 'Jaws');
    expect(jaws.damage.find((d) => d.type === 'piercing').formula).toBe('4d12+15');

    // Pyre Breath's 18d6 is a mean of 63, above the extreme column at either
    // level, so it carries its surplus across: extreme goes 55 -> 60.
    const breath = scaled.abilities.action.find((a) => a.name === 'Pyre Breath');
    expect(breath.text.text).toContain('18d6+5 fire damage');
    // ...and the save DC in the same sentence moves along the spell DC columns.
    expect(breath.text.text).toContain('DC 44 basic Reflex save');
  });

  it('lands a creature on the same column it started on', () => {
    // This is the whole method in one assertion. A creature sitting exactly on
    // the printed high AC for its level must sit exactly on the printed high AC
    // for the level it is moved to.
    const onHigh = { ...troll, ac: { ...troll.ac, value: column('ac', troll.level, 'high') } };
    expect(scaleCreature(onHigh, 3).ac.value).toBe(column('ac', troll.level + 3, 'high'));

    // And the same for a weak spot, which is the half that a single fitted
    // column could not preserve: terrible stays terrible.
    const terrible = column('save', troll.level, 'terrible');
    const frail = { ...troll, saves: { ...troll.saves, reflex: { ...troll.saves.reflex, mod: terrible } } };
    expect(scaleCreature(frail, 3).saves.reflex.mod).toBe(column('save', troll.level + 3, 'terrible'));
  });

  it('keeps a creature between two columns between the same two columns', () => {
    // The troll's AC is not on a column; it sits partway between two, and the
    // fraction is what has to survive.
    const fraction = (creature) => {
      const row = CREATURE_BUILDING.ac.rows[String(creature.level)];
      const i = row.findIndex((v, n) => n < row.length - 1 && creature.ac.value <= v
        && creature.ac.value >= row[n + 1]);
      return [i, (row[i] - creature.ac.value) / (row[i] - row[i + 1])];
    };
    const [before, t] = fraction(troll);
    const [after, u] = fraction(scaleCreature(troll, 4));
    expect(after).toBe(before);
    expect(u).toBeCloseTo(t, 1);
  });

  it('scales skills on the skill table, not on Perception', () => {
    const onHigh = { ...troll, skills: [{ label: 'Athletics', mod: column('skill', troll.level, 'high') }] };
    expect(scaleCreature(onHigh, 4).skills[0].mod).toBe(column('skill', troll.level + 4, 'high'));
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
