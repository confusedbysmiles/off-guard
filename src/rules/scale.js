/**
 * Arbitrary level scaling, -4 to +4.
 *
 * Still NOT rules as written. There is no printed operation for "run this level
 * 5 creature as a level 8". What *is* printed is how a creature of a given
 * level should be built: GM Core pages 114-121 give AC, Perception, saves,
 * skills, HP, attack, damage and spell DC as extreme / high / moderate / low /
 * terrible columns for every level from -1 to 24. This reconstructs the move
 * from those tables, and anything built on it is labelled an approximation in
 * the interface, distinct from elite and weak, which are RAW.
 *
 * Method: place, then move.
 *
 *   Each statistic is placed against its own row for the creature's current
 *   level -- where does AC 27 sit among level 6's extreme 27, high 24,
 *   moderate 23, low 21? -- and then read back off the target level's row at
 *   the same place. A high-AC creature stays a high-AC creature, exactly,
 *   rather than approximately, and a creature with extreme damage and a
 *   moderate attack bonus keeps both.
 *
 *   Between columns the position is interpolated, so AC 26 at level 6 lands
 *   four fifths of the way from high towards extreme and stays there. Outside
 *   the printed columns the surplus or shortfall is carried across unchanged,
 *   which keeps an outlier an outlier instead of dragging it back to the table.
 *
 *   HP is the exception outside the columns: the gap is carried as a *ratio*,
 *   not a difference. A 1 HP oddity scaled up four levels should still be
 *   trivially killable, and adding the difference between the level rows would
 *   give it ninety.
 *
 *   Damage moves the same way, through the Strike Damage column its own mean
 *   sits in, so a brute built on extreme damage gains at the extreme rate. This
 *   replaced a flat 2 per level (4 for a limited-use ability), which was elite
 *   and weak's rate borrowed for a job it was not measured for: it under-fed
 *   extreme damage and over-fed low.
 *
 * Elite and weak remain available on top of a scaled creature; apply this
 * first, then `adjustCreature`, so the HP band is read from the scaled level.
 */
import { adjustFormulaFlat } from '../shared/damage-expression.js';
import { averageOf } from './dice.js';
import { adjustRichText, projectedDamageAdjuster } from './rich-text.js';
import { CREATURE_BUILDING, SCALING_SOURCE } from './tables/creature-scaling.js';

export const SCALE_RANGE = { min: -4, max: 4 };

const LEVELS = Object.keys(CREATURE_BUILDING.ac.rows).map(Number).sort((a, b) => a - b);
const MIN_LEVEL = LEVELS[0];
const MAX_LEVEL = LEVELS[LEVELS.length - 1];

const clampLevel = (level) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));

const rowOf = (table, level) => CREATURE_BUILDING[table].rows[String(clampLevel(level))];

/**
 * Read `value` off `from`'s columns and write it back onto `to`'s.
 *
 * Columns descend, so index 0 is the strongest. `outside` says what to do with
 * a value the printed columns do not reach: `offset` carries the difference,
 * `ratio` carries the proportion (see the note about HP above).
 */
function project(value, from, to, outside = 'offset') {
  const last = from.length - 1;
  const beyond = (i) => (outside === 'ratio'
    ? (from[i] === 0 ? to[i] : to[i] * (value / from[i]))
    : to[i] + (value - from[i]));

  if (value >= from[0]) return beyond(0);
  if (value <= from[last]) return beyond(last);

  for (let i = 0; i < last; i += 1) {
    const hi = from[i];
    const lo = from[i + 1];
    if (value <= hi && value >= lo) {
      // `hi === lo` happens where two printed columns coincide; either end of
      // the segment is the same answer, so take the stronger one.
      const t = hi === lo ? 0 : (hi - value) / (hi - lo);
      return to[i] - t * (to[i] - to[i + 1]);
    }
  }
  return value;
}

/**
 * What a scaling would do, without doing it.
 *
 * There are no per-statistic deltas here any more: with column placement the
 * shift depends on the value being shifted, so there is no single number for
 * "what happens to AC" that would be true for every creature. The dashboard
 * shows the plan; `scaleCreature` does the arithmetic.
 */
export function describeScaling(fromLevel, steps) {
  // Published creatures run past the tables at the top -- there are level 25
  // creatures and the book stops at 24, "the highest-level extreme encounter a
  // party might face". A request that would leave the range is clamped and says
  // so, rather than producing a level 26 creature from level 24 numbers.
  const requested = fromLevel + steps;
  const target = clampLevel(requested);
  return {
    fromLevel,
    targetLevel: target,
    steps: target - fromLevel,
    requestedSteps: steps,
    clamped: target !== requested,
    source: SCALING_SOURCE,
    approximate: true,
  };
}

/** Move one statistic from its column at `from` to the same column at `to`. */
function shift(table, value, from, to, outside) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Math.round(project(value, rowOf(table, from), rowOf(table, to), outside));
}

/**
 * @param {object} creature  a normalized creature record
 * @param {number} steps     -4..+4; 0 removes any existing scaling marker
 */
export function scaleCreature(creature, steps) {
  if (!creature) return creature;
  const n = Math.round(Number(steps) || 0);
  if (n === 0) {
    const { scaling, ...rest } = creature;
    return scaling ? { ...rest, scaling: null } : creature;
  }
  if (n < SCALE_RANGE.min || n > SCALE_RANGE.max) {
    throw new RangeError(`Level scaling is limited to ${SCALE_RANGE.min}..${SCALE_RANGE.max}`);
  }

  const plan = describeScaling(creature.level, n);
  const { fromLevel: from, targetLevel: to } = plan;
  const move = (table, value, outside) => shift(table, value, from, to, outside);

  /** The flat amount to add to a damage formula, from where its mean sits. */
  const damageDelta = (formula) => {
    const mean = averageOf(formula);
    if (mean === null) return 0;
    return Math.round(move('damage', mean)) - Math.round(mean);
  };
  const adjustDamage = projectedDamageAdjuster(damageDelta);
  const adjustDc = (dc) => move('spellDc', dc);

  const scaleAbility = (ability) => ({
    ...ability,
    text: adjustRichText(ability.text, { adjustDamage, adjustDc }),
  });

  return {
    ...creature,
    level: to,
    ac: { ...creature.ac, value: move('ac', creature.ac.value) },
    hp: { ...creature.hp, max: Math.max(1, move('hp', creature.hp.max, 'ratio')) },
    perception: { ...creature.perception, mod: move('perception', creature.perception.mod) },
    saves: {
      ...creature.saves,
      // Each save is placed on its own: a creature with a high Fortitude and a
      // terrible Reflex has to come out the other side with both.
      fortitude: { ...creature.saves.fortitude, mod: move('save', creature.saves.fortitude.mod) },
      reflex: { ...creature.saves.reflex, mod: move('save', creature.saves.reflex.mod) },
      will: { ...creature.saves.will, mod: move('save', creature.saves.will.mod) },
    },
    // Skills have their own printed table (GM Core pg. 116). They used to share
    // Perception's shift, which is close but not the same table.
    skills: creature.skills.map((s) => ({ ...s, mod: move('skill', s.mod) })),
    strikes: creature.strikes.map((strike) => {
      const target = strike.damage.findIndex((x) => x.category !== 'persistent');
      return {
        ...strike,
        mod: move('attack', strike.mod),
        damage: strike.damage.map((x, i) => (
          i === target
            ? { ...x, formula: adjustFormulaFlat(x.formula, damageDelta(x.formula)) }
            : x
        )),
        note: strike.note ? adjustRichText(strike.note, { adjustDamage, adjustDc }) : strike.note,
      };
    }),
    spellcasting: creature.spellcasting.map((entry) => ({
      ...entry,
      dc: move('spellDc', entry.dc),
      attackMod: move('spellAttack', entry.attackMod),
    })),
    abilities: {
      passive: creature.abilities.passive.map(scaleAbility),
      action: creature.abilities.action.map(scaleAbility),
      reaction: creature.abilities.reaction.map(scaleAbility),
      free: creature.abilities.free.map(scaleAbility),
    },
    scaling: plan,
  };
}
