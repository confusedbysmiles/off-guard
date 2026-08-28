/**
 * Difficulty classes.
 *
 * GM Core pg. 53: DCs by level, simple DCs by proficiency rank, and the
 * adjustments for difficulty and rarity.
 */
import {
  DC_ADJUSTMENT, DC_BY_LEVEL, DC_BY_RARITY, DC_BY_SPELL_RANK,
} from './tables/dcs.js';

export { DC_ADJUSTMENT, DC_BY_LEVEL, DC_BY_RARITY, DC_BY_SPELL_RANK };

/** Simple DCs, for tasks with no level. GM Core pg. 53. */
export const SIMPLE_DC = {
  untrained: 10,
  trained: 15,
  expert: 20,
  master: 30,
  legendary: 40,
};

const LEVELS = Object.keys(DC_BY_LEVEL).map(Number);
const MIN_LEVEL = Math.min(...LEVELS);
const MAX_LEVEL = Math.max(...LEVELS);

/**
 * The level-based DC, with an optional rarity adjustment.
 * Levels outside the printed table are clamped, and the result says so.
 */
export function dcByLevel(level, { rarity = 'common', difficulty = null } = {}) {
  const requested = Math.round(Number(level));
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, requested));
  const base = DC_BY_LEVEL[clamped];
  const rarityAdjustment = DC_BY_RARITY[String(rarity).toLowerCase()] ?? 0;
  const difficultyAdjustment = difficulty
    ? DC_ADJUSTMENT[String(difficulty).toLowerCase()] ?? 0
    : 0;
  return {
    dc: base + rarityAdjustment + difficultyAdjustment,
    base,
    level: clamped,
    clamped: clamped !== requested,
    rarity: String(rarity).toLowerCase(),
    rarityAdjustment,
    difficultyAdjustment,
  };
}

/** The DC to counteract or resist a spell of a given rank. GM Core pg. 53. */
export function dcBySpellRank(rank, { rarity = 'common' } = {}) {
  const base = DC_BY_SPELL_RANK[Math.round(Number(rank))];
  if (base === undefined) return null;
  const rarityAdjustment = DC_BY_RARITY[String(rarity).toLowerCase()] ?? 0;
  return { dc: base + rarityAdjustment, base, rarityAdjustment };
}

/** A simple DC by rank, with an optional difficulty adjustment. */
export function simpleDc(rank, { difficulty = null } = {}) {
  const base = SIMPLE_DC[String(rank).toLowerCase()];
  if (base === undefined) return null;
  const adjustment = difficulty ? DC_ADJUSTMENT[String(difficulty).toLowerCase()] ?? 0 : 0;
  return { dc: base + adjustment, base, adjustment };
}

/**
 * Degree of success for a roll against a DC.
 * A natural 20 improves the degree by one step and a natural 1 worsens it
 * (Player Core, Checks).
 */
export const DEGREES = ['critical failure', 'failure', 'success', 'critical success'];

export function degreeOfSuccess(total, dc, { natural = null } = {}) {
  let index;
  if (total >= dc + 10) index = 3;
  else if (total >= dc) index = 2;
  else if (total > dc - 10) index = 1;
  else index = 0;

  if (natural === 20) index = Math.min(3, index + 1);
  else if (natural === 1) index = Math.max(0, index - 1);

  return DEGREES[index];
}
