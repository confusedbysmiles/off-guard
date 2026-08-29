/**
 * Character statistics.
 *
 * A statistic in PF2e is:
 *
 *     attribute modifier + proficiency + item bonus + other
 *
 * where proficiency is 0 when untrained and `level + rank bonus` otherwise.
 * Untrained does *not* add level (Player Core, Proficiency) -- that is the one
 * place this arithmetic surprises people, so it is spelled out rather than
 * folded into a table lookup.
 */

/** Rank name -> the bonus added on top of level. Untrained is special-cased. */
export const PROFICIENCY_BONUS = {
  untrained: 0,
  trained: 2,
  expert: 4,
  master: 6,
  legendary: 8,
};

export const PROFICIENCY_RANKS = Object.keys(PROFICIENCY_BONUS);

/** Numeric rank (Foundry's 0-4) -> name, for importing sheets. */
export const RANK_BY_INDEX = PROFICIENCY_RANKS;

export function rankName(rank) {
  if (typeof rank === 'number') return RANK_BY_INDEX[rank] ?? 'untrained';
  const name = String(rank ?? '').toLowerCase();
  return name in PROFICIENCY_BONUS ? name : 'untrained';
}

/**
 * The proficiency component alone.
 * Untrained contributes nothing at all, not even level.
 */
export function proficiencyBonus(rank, level) {
  const name = rankName(rank);
  if (name === 'untrained') return 0;
  return Number(level ?? 0) + PROFICIENCY_BONUS[name];
}

/**
 * Assemble one statistic, keeping every component so the sheet can show its
 * working and so an override is visibly an override rather than a silent edit.
 *
 * `override` wins outright when it is a number; the computed total is still
 * returned so the interface can show what the character sheet would otherwise
 * have said.
 */
export function statistic({
  attributeMod = 0,
  rank = 'untrained',
  level = 0,
  itemBonus = 0,
  other = 0,
  override = null,
} = {}) {
  const proficiency = proficiencyBonus(rank, level);
  const computed = Number(attributeMod) + proficiency + Number(itemBonus) + Number(other);
  const overridden = typeof override === 'number' && Number.isFinite(override);
  return {
    total: overridden ? override : computed,
    computed,
    overridden,
    components: {
      attributeMod: Number(attributeMod),
      proficiency,
      rank: rankName(rank),
      itemBonus: Number(itemBonus),
      other: Number(other),
    },
  };
}

/**
 * Armour Class. Same shape as any other statistic, but the attribute component
 * is Dexterity capped by the armour, and there is no "level when untrained"
 * exception to worry about because unarmoured defence is always at least
 * trained for a character with a class.
 */
export function armorClass({
  dexMod = 0,
  dexCap = null,
  rank = 'untrained',
  level = 0,
  itemBonus = 0,
  other = 0,
  shieldBonus = 0,
  shieldRaised = false,
  override = null,
} = {}) {
  const cappedDex = dexCap === null ? Number(dexMod) : Math.min(Number(dexMod), Number(dexCap));
  const base = statistic({
    attributeMod: cappedDex,
    rank,
    level,
    itemBonus,
    other,
    override: null,
  });
  const shield = shieldRaised ? Number(shieldBonus) : 0;
  const computed = 10 + base.computed + shield;
  const overridden = typeof override === 'number' && Number.isFinite(override);
  return {
    total: overridden ? override : computed,
    computed,
    overridden,
    components: {
      base: 10,
      dexMod: Number(dexMod),
      // What the cap actually let through. The sheet shows this rather than the
      // raw modifier: "+2 dex (capped)" beside a total that used +1 is the kind
      // of detail that costs ten minutes at a table hunting a missing point.
      dexApplied: cappedDex,
      dexCapped: cappedDex !== Number(dexMod),
      proficiency: base.components.proficiency,
      rank: base.components.rank,
      itemBonus: Number(itemBonus),
      other: Number(other),
      shield,
    },
  };
}

/** Class DC: 10 + attribute + proficiency, no item bonus in the base case. */
export function classDc(opts = {}) {
  const s = statistic(opts);
  return { ...s, total: s.overridden ? s.total : 10 + s.computed, computed: 10 + s.computed };
}
