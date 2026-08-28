/**
 * Encounter XP budget.
 *
 * GM Core pg. 75. The budget is stated for a party of four and adjusted per
 * character above or below that; creature cost is read from the level
 * difference against the party level.
 *
 * The table runs from four levels below the party to four above. A creature
 * outside that is not "very expensive", it is off the table -- the rules give
 * no number, so neither does this. The builder reports it and lets the GM
 * decide, which is the honest failure mode for a tool a GM leans on at 11pm.
 */
import { ENCOUNTER_BUDGET, CREATURE_XP_BY_LEVEL_DIFFERENCE } from './tables/encounter.js';

export const DIFFICULTIES = ['trivial', 'low', 'moderate', 'severe', 'extreme'];

export const STANDARD_PARTY_SIZE = 4;

/** XP budget for one difficulty at a given party size. */
export function budgetFor(difficulty, partySize = STANDARD_PARTY_SIZE) {
  const entry = ENCOUNTER_BUDGET[String(difficulty).toLowerCase()];
  if (!entry) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  const delta = Number(partySize) - STANDARD_PARTY_SIZE;
  return entry.xp + entry.perCharacter * delta;
}

/** Every budget at a given party size, in ascending order. */
export function budgets(partySize = STANDARD_PARTY_SIZE) {
  return DIFFICULTIES.map((difficulty) => ({
    difficulty,
    xp: budgetFor(difficulty, partySize),
    perCharacter: ENCOUNTER_BUDGET[difficulty].perCharacter,
  }));
}

/**
 * What one creature costs against the party level.
 * Returns `{ xp, levelDifference, offTable }`; `xp` is null when off the table.
 */
export function creatureCost(creatureLevel, partyLevel) {
  const levelDifference = Number(creatureLevel) - Number(partyLevel);
  const xp = CREATURE_XP_BY_LEVEL_DIFFERENCE[String(levelDifference)];
  if (xp === undefined) {
    return {
      xp: null,
      levelDifference,
      offTable: true,
      reason: levelDifference > 4
        ? `${levelDifference} levels above the party is beyond the encounter table`
        : `${Math.abs(levelDifference)} levels below the party is beyond the encounter table`,
    };
  }
  return { xp, levelDifference, offTable: false, reason: null };
}

/**
 * Which band a total falls in.
 *
 * Trivial is "40 XP or less", so anything under the trivial budget is still
 * trivial; above extreme there is no band, and the total is reported as beyond
 * extreme rather than pinned to it.
 */
export function difficultyOf(totalXp, partySize = STANDARD_PARTY_SIZE) {
  const scale = budgets(partySize);
  for (const band of scale) {
    if (totalXp <= band.xp) return band.difficulty;
  }
  return 'beyond-extreme';
}

/**
 * Price a whole encounter.
 *
 * @param {Array<{level:number, count?:number, id?:string, name?:string}>} creatures
 * @param {{partyLevel:number, partySize?:number}} party
 */
export function priceEncounter(creatures, { partyLevel, partySize = STANDARD_PARTY_SIZE }) {
  const lines = [];
  let totalXp = 0;
  const offTable = [];

  for (const entry of creatures ?? []) {
    const count = entry.count ?? 1;
    const cost = creatureCost(entry.level, partyLevel);
    const subtotal = cost.offTable ? null : cost.xp * count;
    if (cost.offTable) offTable.push({ ...entry, ...cost });
    else totalXp += subtotal;
    lines.push({ ...entry, count, ...cost, subtotal });
  }

  const scale = budgets(partySize);
  return {
    partyLevel,
    partySize,
    totalXp,
    // A total that omits an off-table creature is not a total, and the caller
    // must not present it as one.
    complete: offTable.length === 0,
    offTable,
    difficulty: offTable.length === 0 ? difficultyOf(totalXp, partySize) : null,
    lines,
    budgets: scale,
    /** How far the total sits from each band, for a budget meter. */
    headroom: Object.fromEntries(scale.map((b) => [b.difficulty, b.xp - totalXp])),
  };
}

/**
 * Re-price an encounter against a different party, for copying between
 * campaigns. Reports whether the difficulty band moved.
 */
export function repriceEncounter(creatures, from, to) {
  const before = priceEncounter(creatures, from);
  const after = priceEncounter(creatures, to);
  return {
    before,
    after,
    bandChanged: before.difficulty !== after.difficulty,
    xpChanged: before.totalXp !== after.totalXp,
  };
}
