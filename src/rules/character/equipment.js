/**
 * Armour, weapons, shields and the bag.
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
 * and the build holds the runes.
 *
 * And the item behind a row need not come from the catalogue at all. See
 * `customWeapon` and its neighbours: a die, a damage type and a proficiency
 * category are everything the arithmetic here reads, so a homebrew axe is a
 * record like any other -- sanitised on the way in, because the build document
 * is written by the player's own browser.
 */
import { PROFICIENCY_BONUS, proficiencyBonus, rankName } from '../proficiency.js';
import { coinBulk, tenthsOf, wornTenths } from './bulk.js';

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

/**
 * A shield, onto the fields the sheet already had for one.
 *
 * `shield.raised` is deliberately not among them. A shield is worth its bonus
 * only on the round you Raise it, and raising one is something you do at the
 * table -- so the builder says what the shield is and the player says whether
 * it is up. The sheet's Armour Class has read both since long before there was
 * a builder, which is why this fills in its shape rather than inventing one:
 * two `shield` objects with different spellings would have locked the raise
 * toggle and left nobody able to press it.
 *
 * The Broken Threshold is half a shield's Hit Points wherever one is not
 * printed, which is every shield in the core rules.
 */
export function shieldFrom(entry = {}, record = null) {
  if (!entry?.id && !entry?.custom && !entry?.name) return null;
  const hp = Number(record?.hp ?? 0);
  return {
    name: entry.name || record?.name || String(entry.id ?? 'Shield'),
    bonus: Number(record?.acBonus ?? 0),
    hardness: Number(record?.hardness ?? 0),
    hp,
    breakThreshold: Number(record?.brokenThreshold ?? 0) || Math.floor(hp / 2),
  };
}

/**
 * Everything carried that is not a weapon, a shield or armour: rope, rations,
 * potions, the sack of gems.
 *
 * A row is the catalogue item plus a count plus whatever the player calls it,
 * the same three parts a weapon is made of, so "a custom item" is again a
 * matter of naming one rather than of inventing a compendium entry. An entry
 * with no catalogue item at all is legal and carries no Bulk -- somebody
 * writing down "the duke's letter" should not have to find it in a book first.
 */
export function gearRows(entries = [], items = {}) {
  return (entries ?? []).map((entry) => {
    const record = recordFor(entry, items, customGear);
    const quantity = Math.max(1, Math.trunc(Number(entry?.quantity ?? 1)) || 1);
    return {
      id: entry?.id ?? null,
      name: entry?.name || record?.name || String(entry?.id ?? 'Something'),
      baseName: record?.name ?? null,
      quantity,
      bulk: tenthsOf(record?.bulk ?? 0),
      level: record?.level ?? null,
      price: record?.price ?? null,
      missing: Boolean(entry?.id && !record),
    };
  });
}

/**
 * What all of it weighs.
 *
 * Worn armour, the weapons on the list, the shield, the gear and the purse.
 * Everything a character owns is assumed to be on them: a builder has no idea
 * what was left at the inn, and guessing would be worse than counting.
 */
export function carriedTenths({
  armor = null, shield = null, weapons = [], gear = [], coins = {}, items = {},
} = {}) {
  let total = 0;

  const armorRecord = recordFor(armor, items, customArmor);
  if (armorRecord) total += wornTenths(tenthsOf(armorRecord.bulk));

  const shieldRecord = recordFor(shield, items, customShield);
  if (shieldRecord) total += tenthsOf(shieldRecord.bulk);

  for (const entry of weapons ?? []) {
    const record = recordFor(entry, items, customWeapon);
    if (record) total += tenthsOf(record.bulk);
  }

  for (const row of gearRows(gear, items)) total += row.bulk * row.quantity;

  return total + coinBulk(coins);
}

/**
 * Items the catalogue does not have.
 *
 * A player whose GM handed them a weapon out of a homebrew document, or who is
 * playing something the compendium build has not caught up with, needs the
 * numbers to work -- not a name with nothing behind it. So a row can carry its
 * own record instead of pointing at one, and everything downstream treats the
 * two identically: `strikeFrom` cannot tell whether a longsword came from the
 * catalogue or from somebody typing `d8`, `slashing`, `martial`.
 *
 * Which is exactly why these are sanitised here rather than trusted. The build
 * document is written by the player's own browser, and a `die` of `d97` or a
 * `dexCap` of `"none"` would otherwise reach the arithmetic and come out the
 * far side as a sheet full of `NaN`. Every field is clamped to something the
 * rules can actually mean, and anything unrecognised falls back rather than
 * throwing: a half-typed custom item is the normal state of one being typed.
 */
const DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];
const DAMAGE_TYPES = ['bludgeoning', 'piercing', 'slashing'];
const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_CATEGORIES = ['unarmored', 'light', 'medium', 'heavy'];

const oneOf = (value, allowed, fallback) => (allowed.includes(String(value)) ? String(value) : fallback);
const clamp = (value, low, high, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
};
const optional = (value, low, high) => (value === null || value === undefined || value === ''
  ? null
  : clamp(value, low, high, null));

/** Free text -- "finesse, agile" -- as the trait slugs the rules check for. */
export const customTraits = (text) => String(text ?? '')
  .split(',')
  .map((trait) => trait.trim().toLowerCase().replace(/\s+/g, '-'))
  .filter(Boolean);

/** A name, or nothing: an item with neither a name nor an id is not an item. */
const named = (custom, fallback) => String(custom?.name ?? '').trim() || fallback;

export function customWeapon(custom) {
  if (!custom) return null;
  const range = optional(custom.range, 0, 1000);
  return {
    name: named(custom, 'Custom weapon'),
    itemType: 'weapon',
    category: oneOf(custom.category, WEAPON_CATEGORIES, 'simple'),
    group: null,
    level: 0,
    bulk: clamp(custom.bulk, 0, 100, 0),
    price: null,
    traits: customTraits(custom.traits),
    damage: {
      dice: 1,
      die: oneOf(custom.die, DICE, 'd6'),
      type: oneOf(custom.damageType, DAMAGE_TYPES, 'bludgeoning'),
    },
    range,
    reload: null,
    hands: null,
    custom: true,
  };
}

export function customArmor(custom) {
  if (!custom) return null;
  return {
    name: named(custom, 'Custom armour'),
    itemType: 'armor',
    category: oneOf(custom.category, ARMOR_CATEGORIES, 'light'),
    group: null,
    level: 0,
    bulk: clamp(custom.bulk, 0, 100, 0),
    price: null,
    traits: customTraits(custom.traits),
    acBonus: clamp(custom.acBonus, 0, 10, 0),
    // `null` and `0` are different: no cap at all, versus a cap of zero.
    dexCap: optional(custom.dexCap, 0, 10),
    checkPenalty: clamp(custom.checkPenalty, -10, 0, 0),
    speedPenalty: clamp(custom.speedPenalty, -30, 0, 0),
    strength: optional(custom.strength, -5, 10),
    custom: true,
  };
}

export function customShield(custom) {
  if (!custom) return null;
  return {
    name: named(custom, 'Custom shield'),
    itemType: 'shield',
    category: null,
    group: null,
    level: 0,
    bulk: clamp(custom.bulk, 0, 100, 0),
    price: null,
    traits: [],
    acBonus: clamp(custom.acBonus, 0, 6, 0),
    hardness: clamp(custom.hardness, 0, 40, 0),
    hp: clamp(custom.hp, 0, 200, 0),
    speedPenalty: clamp(custom.speedPenalty, -30, 0, 0),
    custom: true,
  };
}

export function customGear(custom) {
  if (!custom) return null;
  return {
    name: named(custom, 'Something'),
    itemType: 'equipment',
    category: null,
    group: null,
    level: 0,
    bulk: clamp(custom.bulk, 0, 100, 0),
    price: null,
    traits: [],
    custom: true,
  };
}

/**
 * The record behind a row, from wherever it comes.
 *
 * A catalogue id wins where it resolves; otherwise the row's own description
 * stands in. An id that no longer resolves returns nothing, which is how a feat
 * or an item removed by an upstream bump shows as a gap rather than silently
 * becoming a different thing.
 */
export function recordFor(entry, items = {}, describe = customGear) {
  if (entry?.id) return items[entry.id] ?? null;
  return entry?.custom ? describe(entry.custom) : null;
}
