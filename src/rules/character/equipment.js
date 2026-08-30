/**
 * Armour and weapons, from the equipment a character actually carries.
 *
 * This is the part the Pathbuilder import cannot do, and the reason is worth
 * stating: an export gives a finished total and leaves the sheet to work
 * backwards. The importer infers an armour's Dexterity cap from how much
 * Dexterity reached the AC, and warns that it cannot tell whether Strength
 * applies to a given weapon's damage because weapon traits are not exported at
 * all.
 *
 * Here both are fields. `dexCap` is on the armour, `finesse` and `propulsive`
 * are on the weapon, and the arithmetic is done forwards from the rulebook
 * rather than reconstructed from its answer.
 *
 * Runes are the player's, not the item's: a `+1 striking longsword` is a
 * longsword with two numbers beside it, so the catalogue holds one longsword
 * and the build holds the runes. That is what makes "add a custom item" a
 * matter of naming it rather than of creating a new compendium entry.
 */
import { PROFICIENCY_BONUS, proficiencyBonus, rankName } from '../proficiency.js';

/** A striking rune adds dice, not a bonus. Getting this wrong halves damage. */
export const STRIKING_DICE = { 0: 1, 1: 2, 2: 3, 3: 4 };

/**
 * Weapon Specialization: flat damage from the class's own proficiency.
 * Player Core -- +2/+3/+4 at expert, master and legendary, doubled by Greater.
 */
const SPECIALIZATION = { expert: 2, master: 3, legendary: 4 };

export function weaponSpecializationDamage(rank, kind) {
  if (!kind) return 0;
  const base = SPECIALIZATION[rankName(rank)] ?? 0;
  return kind === 'greater' ? base * 2 : base;
}

/**
 * Armour Class.
 *
 * `dexCap` of `0` and no cap at all are different things -- full plate is the
 * first -- so the absent case is `null` and never conflated with zero.
 */
export function armorClassFrom({
  armor = null, worn = null, proficiencies = {}, dexMod = 0, level = 1,
} = {}) {
  // Nothing worn is not an absence of rules: unarmoured defence has its own
  // proficiency, and for most classes it is trained from level 1.
  const category = armor?.category ?? 'unarmored';
  const rank = proficiencies.defenses?.[category] ?? 'untrained';
  const potency = Number(worn?.potency ?? 0);

  return {
    rank,
    dexCap: armor?.dexCap ?? null,
    itemBonus: Number(armor?.acBonus ?? 0) + potency,
    category,
    checkPenalty: Number(armor?.checkPenalty ?? 0),
    speedPenalty: Number(armor?.speedPenalty ?? 0),
    /**
     * Armour asks for a Strength modifier and stops penalising you at it. Not
     * applied automatically -- the penalty is to skills and Speed rather than
     * to AC -- but reported, because a heavily armoured character who never
     * met the requirement is carrying a penalty they may not know about.
     */
    strengthRequired: armor?.strength ?? null,
  };
}

const has = (weapon, trait) => (weapon?.traits ?? []).some((t) => t === trait || t.startsWith(`${trait}-`));

/** Which attribute a weapon attacks with. */
export function attackAttribute(weapon, mods = {}) {
  const ranged = Number.isFinite(weapon?.range) && weapon.range !== null;
  if (ranged) return { key: 'dex', mod: Number(mods.dex ?? 0) };
  // Finesse lets you attack with Dexterity instead, and a player choosing
  // between them always takes the higher.
  if (has(weapon, 'finesse') && Number(mods.dex ?? 0) > Number(mods.str ?? 0)) {
    return { key: 'dex', mod: Number(mods.dex ?? 0) };
  }
  return { key: 'str', mod: Number(mods.str ?? 0) };
}

/**
 * Which attribute a weapon adds to damage, which is not the same question.
 *
 * A rapier attacks with Dexterity and damages with Strength; a bow does neither
 * unless it is propulsive, which adds half a positive Strength modifier and all
 * of a negative one.
 */
export function damageAttribute(weapon, mods = {}) {
  const str = Number(mods.str ?? 0);
  const ranged = Number.isFinite(weapon?.range) && weapon.range !== null;
  if (!ranged) return str;
  if (has(weapon, 'propulsive')) return str >= 0 ? Math.floor(str / 2) : str;
  return 0;
}

/**
 * One strike, as the sheet records it.
 *
 * The shape is `mapPathbuilder`'s, so a built character's strikes and an
 * imported one's are the same rows on the same sheet.
 */
export function strikeFrom(entry = {}, {
  weapon = null, proficiencies = {}, mods = {}, level = 1, specialization = null,
} = {}) {
  const category = weapon?.category ?? 'unarmed';
  const rank = proficiencies.attacks?.[category] ?? 'untrained';
  const potency = Number(entry.potency ?? 0);

  const attack = attackAttribute(weapon, mods);
  const mod = attack.mod + proficiencyBonus(rank, level) + potency + Number(entry.other ?? 0);

  const dice = (STRIKING_DICE[Number(entry.striking ?? 0)] ?? 1)
    + Number(weapon?.damage?.dice ?? 1) - 1;
  const die = weapon?.damage?.die ?? null;

  const flat = damageAttribute(weapon, mods)
    + weaponSpecializationDamage(rank, specialization)
    + Number(entry.damageBonus ?? 0);

  const formula = die
    ? `${dice}${die}${flat ? (flat > 0 ? `+${flat}` : flat) : ''}`
    : (flat ? String(flat) : '');

  // Runes and a custom name are the player's; the base weapon is the
  // catalogue's. Both are shown, because "+1 striking longsword" is what they
  // call it and "longsword" is what the rules are about.
  const runes = [
    potency ? `+${potency}` : null,
    ['', 'striking', 'greater striking', 'major striking'][Number(entry.striking ?? 0)] || null,
    ...(entry.property ?? []),
  ].filter(Boolean);

  return {
    name: entry.name || [...runes, weapon?.name].filter(Boolean).join(' ') || 'Unnamed strike',
    baseName: weapon?.name ?? null,
    mod,
    damage: formula,
    damageType: weapon?.damage?.type ?? '',
    traitsText: (weapon?.traits ?? []).join(', '),
    /** Kept apart so the sheet can show its working, as it does everywhere else. */
    components: {
      attributeMod: attack.mod,
      attribute: attack.key,
      proficiency: proficiencyBonus(rank, level),
      rank: rankName(rank),
      potency,
      dice,
      die,
      damageFlat: flat,
      specialization: weaponSpecializationDamage(rank, specialization),
    },
  };
}

export { PROFICIENCY_BONUS };
