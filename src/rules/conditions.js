/**
 * Conditions, dying, and what happens at the end of a turn.
 *
 * The rule this module is built around, from the brief and from experience at a
 * table: apply what the rules state plainly, and *prompt* for everything else.
 * A tracker that silently decrements the wrong thing is worse than one that
 * asks, because nobody notices until the fight is over.
 *
 * Only one condition decreases on its own at the end of a turn. Checked against
 * every condition's printed text in the pinned checkout: frightened says "at the
 * end of each of your turns, the value of your frightened condition decreases by
 * 1" (Player Core). Doomed and drained key off a night's rest, fatigued off
 * rest, and stunned off actions actually lost -- none of which a turn boundary
 * can decide.
 */
import { CONDITIONS } from './tables/conditions.js';

export { CONDITIONS };

export const CONDITION_SLUGS = Object.keys(CONDITIONS).sort();

export const isValued = (slug) => Boolean(CONDITIONS[slug]?.valued);

/** Dying 4 is death. Player Core, Dying. */
export const DYING_MAXIMUM = 4;

/** The flat check to end persistent damage. Player Core, Persistent Damage. */
export const PERSISTENT_FLAT_DC = 15;

/**
 * Add a condition, or raise its value.
 *
 * A valued condition taken twice does not stack: the higher value applies
 * (Player Core, Conditions). A condition that overrides another removes it.
 */
export function addCondition(conditions, slug, value = null) {
  const definition = CONDITIONS[slug];
  if (!definition) return conditions;

  const next = conditions.filter((c) => !(definition.overrides ?? []).includes(c.slug));
  const existing = next.findIndex((c) => c.slug === slug);
  const wanted = definition.valued ? Math.max(1, Number(value ?? 1)) : null;

  if (existing === -1) return [...next, { slug, value: wanted }];
  if (!definition.valued) return next;
  return next.map((c, i) => (
    i === existing ? { ...c, value: Math.max(Number(c.value ?? 1), wanted) } : c
  ));
}

export function removeCondition(conditions, slug) {
  return conditions.filter((c) => c.slug !== slug);
}

export function setConditionValue(conditions, slug, value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return removeCondition(conditions, slug);
  return conditions.map((c) => (c.slug === slug ? { ...c, value: amount } : c));
}

export const conditionValue = (conditions, slug) =>
  conditions.find((c) => c.slug === slug)?.value ?? null;

/**
 * What the end of this combatant's turn does.
 *
 * Returns two lists. `automatic` is applied without asking, because the rule
 * states it outright. `prompts` is everything the GM has to decide, each with
 * the reason it cannot be decided here.
 */
export function endOfTurn(combatant) {
  const conditions = combatant.conditions ?? [];
  const automatic = [];
  const prompts = [];

  const frightened = conditionValue(conditions, 'frightened');
  if (frightened !== null) {
    automatic.push({
      kind: 'decrement',
      slug: 'frightened',
      from: frightened,
      to: frightened - 1,
      because: 'Frightened decreases by 1 at the end of each of your turns.',
    });
  }

  for (const entry of combatant.persistentDamage ?? []) {
    prompts.push({
      kind: 'persistent-damage',
      formula: entry.formula,
      damageType: entry.type,
      flatCheckDc: entry.dc ?? PERSISTENT_FLAT_DC,
      because: 'Persistent damage is taken at the end of your turn, then a flat '
        + `check of DC ${entry.dc ?? PERSISTENT_FLAT_DC} ends it on a success.`,
    });
  }

  // Stunned is spent by actions lost, which happened during the turn and is not
  // something a turn boundary can work out.
  const stunned = conditionValue(conditions, 'stunned');
  if (stunned !== null) {
    prompts.push({
      kind: 'stunned',
      value: stunned,
      because: 'Stunned decreases by the number of actions actually lost, so it '
        + 'depends on what happened this turn.',
    });
  }

  return { automatic, prompts };
}

/** Apply the automatic part of `endOfTurn`. */
export function applyAutomatic(conditions, automatic) {
  let next = conditions;
  for (const change of automatic) {
    if (change.kind !== 'decrement') continue;
    next = change.to <= 0
      ? removeCondition(next, change.slug)
      : setConditionValue(next, change.slug, change.to);
  }
  return next;
}

/**
 * What the start of a turn asks about.
 *
 * A dying character rolls a recovery check; the result is a die roll and four
 * outcomes, so it is a prompt rather than something applied here.
 */
export function startOfTurn(combatant) {
  const prompts = [];
  const dying = Number(combatant.dying ?? 0);
  if (dying > 0) {
    prompts.push({
      kind: 'recovery-check',
      dying,
      dc: 10 + dying,
      because: 'A dying creature attempts a recovery check at the start of its '
        + 'turn. The DC is 10 plus the dying value.',
    });
  }
  return { automatic: [], prompts };
}

/**
 * Damage, with temporary hit points, dying and wounded handled.
 *
 * A negative amount heals, which is the entry the brief asks for: a GM typing
 * "-8" into the damage box means eight healing, and typing it into a separate
 * heal box is one more thing to get wrong at speed.
 *
 * Player Core, Dying: taking damage at 0 hit points increases dying by 1;
 * dropping to 0 gives dying 1 plus the wounded value; healing above 0 removes
 * dying and leaves the wounded value alone.
 */
export function applyDamage(combatant, amount) {
  const damage = Math.round(Number(amount) || 0);
  const max = Number(combatant.hpMax ?? 0);
  let current = Number(combatant.hpCurrent ?? max);
  let temp = Number(combatant.hpTemp ?? 0);
  let dying = Number(combatant.dying ?? 0);
  const wounded = Number(combatant.wounded ?? 0);
  let woundedAfter = wounded;
  const notes = [];

  if (damage > 0) {
    let remaining = damage;
    if (temp > 0) {
      // Temporary hit points are spent first and are not restored by healing.
      const absorbed = Math.min(temp, remaining);
      temp -= absorbed;
      remaining -= absorbed;
      if (absorbed) notes.push(`${absorbed} absorbed by temporary hit points.`);
    }

    if (current === 0 && remaining > 0 && dying > 0) {
      dying += 1;
      notes.push(`Damage while dying: dying ${dying - 1} becomes ${dying}.`);
    } else if (remaining > 0) {
      const before = current;
      current = Math.max(0, current - remaining);
      if (before > 0 && current === 0) {
        dying = 1 + wounded;
        notes.push(wounded
          ? `Dropped to 0 while wounded ${wounded}: dying ${dying}.`
          : 'Dropped to 0 hit points: dying 1.');
      }
    }
  } else if (damage < 0) {
    const healed = Math.min(-damage, max - current);
    current += healed;
    if (dying > 0 && current > 0) {
      // Player Core, Wounded: losing the dying condition -- by any means, not
      // only a successful recovery check -- makes you wounded, or raises the
      // value you already had.
      dying = 0;
      woundedAfter = wounded + 1;
      notes.push(`Healed above 0: no longer dying, and now wounded ${woundedAfter}.`);
    }
  }

  if (dying >= DYING_MAXIMUM) {
    notes.push(`Dying ${dying}: this creature is dead.`);
  }

  return {
    hpCurrent: current,
    hpTemp: temp,
    dying,
    wounded: woundedAfter,
    dead: dying >= DYING_MAXIMUM,
    notes,
  };
}

/**
 * Losing the dying condition. Player Core, Wounded.
 * Wounded goes up by one every time dying ends, not every time it changes.
 */
export function recoverFromDying(combatant) {
  return {
    dying: 0,
    wounded: Number(combatant.wounded ?? 0) + 1,
  };
}
