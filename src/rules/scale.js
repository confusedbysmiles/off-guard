/**
 * Arbitrary level scaling, -4 to +4.
 *
 * NOT rules as written. There is no printed operation for "run this level 5
 * creature as a level 8"; the GM Core creature-building tables describe what a
 * creature of a given level should look like, and this reconstructs the move
 * from them. Anything built on it must be labelled an approximation in the
 * interface, distinct from elite and weak, which are RAW.
 *
 * Method:
 *
 *   - Statistics that are flat modifiers (AC, Perception, saves, skills, strike
 *     attack, spell DC and attack) shift by the difference between the source
 *     and target rows of `CREATURE_STATS_BY_LEVEL`. Using a difference rather
 *     than the row value preserves how far this particular creature sits above
 *     or below the norm: a high-AC creature stays a high-AC creature.
 *   - HP scales by the *ratio* of the rows, not the difference. Adding the
 *     level-5-minus-level-1 difference to a 6 HP goblin would give it 61; the
 *     ratio gives it 22, which is what a level 5 creature of its build looks
 *     like.
 *   - Damage shifts by 2 per level of change, 4 for a limited-use ability.
 *     That is elite and weak's own rate (Monster Core: +1 level, +2 damage,
 *     +4 limited use), and it tracks the published medians closely across the
 *     range -- level 1 to 5 gives +8 against an observed median gap of 8.
 *
 * Elite and weak remain available on top of a scaled creature; apply this
 * first, then `adjustCreature`, so the HP band is read from the scaled level.
 */
import { adjustFormulaFlat } from '../shared/damage-expression.js';
import { adjustRichText, flatDamageAdjuster } from './rich-text.js';
import { isLimitedUse } from './adjust.js';
import { CREATURE_STATS_BY_LEVEL, SCALING_SOURCE } from './tables/creature-scaling.js';

export const SCALE_RANGE = { min: -4, max: 4 };

/** Damage change per level of scaling. See the note above. */
const DAMAGE_PER_LEVEL = 2;
const LIMITED_DAMAGE_PER_LEVEL = 4;

const LEVELS = Object.keys(CREATURE_STATS_BY_LEVEL).map(Number).sort((a, b) => a - b);
const MIN_LEVEL = LEVELS[0];
const MAX_LEVEL = LEVELS[LEVELS.length - 1];

const clampLevel = (level) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));

function row(level) {
  return CREATURE_STATS_BY_LEVEL[clampLevel(level)];
}

/**
 * What a scaling would do, without doing it. The dashboard shows this before
 * the GM commits, and it is also how the "outside the table" case is reported.
 */
export function describeScaling(fromLevel, steps) {
  // Published creatures run from level -1 to 25 and the table stops there, so
  // a request that would leave the range is clamped and says so. Letting the
  // level move past the last row would otherwise produce a "level -2" creature
  // with level -1 statistics and reduced damage, which is worse than refusing.
  const requested = fromLevel + steps;
  const target = clampLevel(requested);
  const effectiveSteps = target - fromLevel;
  const from = row(fromLevel);
  const to = row(target);
  return {
    fromLevel,
    targetLevel: target,
    steps: effectiveSteps,
    requestedSteps: steps,
    clamped: target !== requested,
    source: SCALING_SOURCE,
    approximate: true,
    deltas: {
      ac: to.ac - from.ac,
      perception: to.perception - from.perception,
      save: to.save - from.save,
      attack: to.attack - from.attack,
      spellDc: (to.spellDc ?? to.ac) - (from.spellDc ?? from.ac),
      hpRatio: from.hp > 0 ? to.hp / from.hp : 1,
      damage: DAMAGE_PER_LEVEL * effectiveSteps,
      limitedDamage: LIMITED_DAMAGE_PER_LEVEL * effectiveSteps,
    },
  };
}

const bump = (value, delta) => (typeof value === 'number' ? value + delta : value);

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
  const d = plan.deltas;
  const dmgAdjuster = flatDamageAdjuster(d.damage);
  const limitedAdjuster = flatDamageAdjuster(d.limitedDamage);

  const scaleAbility = (ability) => ({
    ...ability,
    text: adjustRichText(ability.text, {
      adjustDamage: isLimitedUse(ability) ? limitedAdjuster : dmgAdjuster,
      dcDelta: d.spellDc,
    }),
  });

  return {
    ...creature,
    level: plan.targetLevel,
    ac: { ...creature.ac, value: bump(creature.ac.value, d.ac) },
    hp: { ...creature.hp, max: Math.max(1, Math.round(creature.hp.max * d.hpRatio)) },
    perception: { ...creature.perception, mod: bump(creature.perception.mod, d.perception) },
    saves: {
      ...creature.saves,
      fortitude: { ...creature.saves.fortitude, mod: bump(creature.saves.fortitude.mod, d.save) },
      reflex: { ...creature.saves.reflex, mod: bump(creature.saves.reflex.mod, d.save) },
      will: { ...creature.saves.will, mod: bump(creature.saves.will.mod, d.save) },
    },
    // Skills have no column of their own in the fitted table; they track
    // Perception closely in the published data and share its delta here.
    skills: creature.skills.map((s) => ({ ...s, mod: bump(s.mod, d.perception) })),
    strikes: creature.strikes.map((strike) => {
      const target = strike.damage.findIndex((x) => x.category !== 'persistent');
      return {
        ...strike,
        mod: bump(strike.mod, d.attack),
        damage: strike.damage.map((x, i) => (
          i === target ? { ...x, formula: adjustFormulaFlat(x.formula, d.damage) } : x
        )),
        note: strike.note
          ? adjustRichText(strike.note, { adjustDamage: dmgAdjuster, dcDelta: d.spellDc })
          : strike.note,
      };
    }),
    spellcasting: creature.spellcasting.map((entry) => ({
      ...entry,
      dc: bump(entry.dc, d.spellDc),
      attackMod: bump(entry.attackMod, d.attack),
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
