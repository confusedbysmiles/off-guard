/**
 * Elite and weak adjustments.
 *
 * Monster Core, Elite and Weak Adjustments. Applied as a non-destructive
 * transform: `adjustCreature` returns a new record and never touches the one it
 * was given, so toggling the adjustment off restores the original exactly.
 *
 * Elite
 *   Level +1, or +2 if the creature is level -1 or 0.
 *   AC, attack modifiers, DCs, saves, Perception and skill modifiers +2.
 *   Damage +2, or +4 for an ability with limited uses or a frequency.
 *   HP by *starting* level: +10 at 1 or lower, +15 at 2-4, +20 at 5-19,
 *   +30 at 20 or higher.
 *
 * Weak is the mirror: level -1 (or -2 at level 1), modifiers -2, damage -2
 * (-4 limited use), HP -10/-15/-20/-30 on the same starting-level bands.
 */
import { adjustFormulaFlat } from '../shared/damage-expression.js';
import { adjustRichText, flatDamageAdjuster } from './rich-text.js';

/** HP change by the creature's level *before* adjustment. */
function hpDelta(startingLevel, direction) {
  const magnitude =
    startingLevel <= 1 ? 10
      : startingLevel <= 4 ? 15
        : startingLevel <= 19 ? 20
          : 30;
  return magnitude * direction;
}

/** Level change: doubled at the bottom of the range so the band still moves. */
function levelDelta(level, direction) {
  if (direction > 0) return (level === -1 || level === 0) ? 2 : 1;
  return (level === 1) ? -2 : -1;
}

/**
 * Whether an ability takes the larger damage adjustment.
 *
 * "an ability that has limited uses or a frequency". Upstream expresses that
 * two ways -- a structured `frequency`, and prose alone ("can't use Pyre Breath
 * again for 1d4 rounds") -- so the normalizer keeps both and this reads either.
 * Spells are limited-use by nature and are handled where spellcasting is.
 */
export function isLimitedUse(ability) {
  return Boolean(ability?.frequency || ability?.rechargeNote);
}

const bump = (value, delta) => (typeof value === 'number' ? value + delta : value);

function adjustAbility(ability, { mod, damage, limitedDamage }) {
  const delta = isLimitedUse(ability) ? limitedDamage : damage;
  return {
    ...ability,
    text: adjustRichText(ability.text, {
      adjustDamage: flatDamageAdjuster(delta),
      dcDelta: mod,
    }),
  };
}

function adjustStrike(strike, { mod, damage }) {
  const target = strike.damage.findIndex((d) => d.category !== 'persistent');
  return {
    ...strike,
    mod: bump(strike.mod, mod),
    damage: strike.damage.map((d, i) => (
      i === target ? { ...d, formula: adjustFormulaFlat(d.formula, damage) } : d
    )),
    note: strike.note
      ? adjustRichText(strike.note, { adjustDamage: flatDamageAdjuster(damage), dcDelta: mod })
      : strike.note,
  };
}

/**
 * @param {object} creature  a normalized creature record
 * @param {'elite'|'weak'|null} kind
 */
export function adjustCreature(creature, kind) {
  if (!creature) return creature;
  if (kind !== 'elite' && kind !== 'weak') {
    const { adjustment, ...rest } = creature;
    return adjustment ? { ...rest, adjustment: null } : creature;
  }

  const direction = kind === 'elite' ? 1 : -1;
  const mod = 2 * direction;
  const damage = 2 * direction;
  const limitedDamage = 4 * direction;
  const startingLevel = creature.level;

  const abilityOpts = { mod, damage, limitedDamage };

  return {
    ...creature,
    level: startingLevel + levelDelta(startingLevel, direction),
    ac: { ...creature.ac, value: bump(creature.ac.value, mod) },
    hp: { ...creature.hp, max: Math.max(1, creature.hp.max + hpDelta(startingLevel, direction)) },
    perception: { ...creature.perception, mod: bump(creature.perception.mod, mod) },
    saves: {
      ...creature.saves,
      fortitude: { ...creature.saves.fortitude, mod: bump(creature.saves.fortitude.mod, mod) },
      reflex: { ...creature.saves.reflex, mod: bump(creature.saves.reflex.mod, mod) },
      will: { ...creature.saves.will, mod: bump(creature.saves.will.mod, mod) },
    },
    skills: creature.skills.map((s) => ({ ...s, mod: bump(s.mod, mod) })),
    strikes: creature.strikes.map((s) => adjustStrike(s, { mod, damage })),
    spellcasting: creature.spellcasting.map((entry) => ({
      ...entry,
      dc: bump(entry.dc, mod),
      attackMod: bump(entry.attackMod, mod),
    })),
    abilities: {
      passive: creature.abilities.passive.map((a) => adjustAbility(a, abilityOpts)),
      action: creature.abilities.action.map((a) => adjustAbility(a, abilityOpts)),
      reaction: creature.abilities.reaction.map((a) => adjustAbility(a, abilityOpts)),
      free: creature.abilities.free.map((a) => adjustAbility(a, abilityOpts)),
    },
    adjustment: {
      kind,
      startingLevel,
      hpDelta: hpDelta(startingLevel, direction),
      modDelta: mod,
      label: kind === 'elite' ? 'Elite' : 'Weak',
    },
  };
}
