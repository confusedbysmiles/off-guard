/**
 * Effects: the things that change a number for a while.
 *
 * `derive.js` says plainly that what a feat mechanically does is not
 * attempted -- upstream encodes effects only as Foundry rule elements, and a
 * builder that half-evaluated them would be wrong in ways nobody could see.
 * That still holds, and this does not weaken it. Nothing here is inferred from
 * a feat, a spell or an item. Somebody says what Rage does, once, and turns it
 * on; the application never reads a rule and guesses.
 *
 * Two things feed it:
 *
 *   `sheet.effects`     written by the player or pushed by the GM. Play state,
 *                       beside conditions -- never a derived path, so the
 *                       builder does not own it and cannot stamp it back.
 *
 *   `sheet.conditions`  already tracked, already valued. The ten conditions
 *                       that carry a number carry the same numbers every time,
 *                       so they are written out below with the sentence each
 *                       one comes from.
 *
 * Nothing is ever written to the field it changes. A raging barbarian's +2 is
 * not stored on `strikes`, which the build owns and would overwrite; it is
 * added when the number is shown. Turning the effect off restores the sheet
 * exactly, because the sheet never moved.
 */
import { SKILLS, SKILL_ATTRIBUTE } from './derive.js';

/**
 * The four kinds of modifier, and the only reason this file is not a sum.
 *
 * Player Core, Bonuses and Penalties: "you can have only one bonus of a given
 * type at a time -- the highest one applies", and the same for penalties, with
 * the worst applying. Untyped bonuses and penalties stack with everything,
 * including each other.
 */
export const BONUS_TYPES = ['circumstance', 'status', 'item', 'untyped'];

/** Where a modifier can land. A group expands to several of these. */
export const TARGETS = [
  'ac', 'perception', 'classDc', 'speed', 'hp.max',
  ...['fortitude', 'reflex', 'will'].map((s) => `saves.${s}`),
  ...SKILLS.map((s) => `skills.${s}`),
  /**
   * Every Lore at once, because a Lore is named rather than chosen and the
   * sheet cannot know in advance which ones a character has. They are all
   * Intelligence skills, so one target covers them.
   */
  'skills.lore',
  'strike.attack', 'strike.damage',
];

/**
 * Every check and DC.
 *
 * Armour Class is a DC, which is why frightened lowers it -- the part of that
 * condition people forget. Speed is neither, and damage is a roll but not a
 * check, so neither is in here.
 */
const EVERY_CHECK = [
  'ac', 'perception', 'classDc',
  ...['fortitude', 'reflex', 'will'].map((s) => `saves.${s}`),
  ...SKILLS.map((s) => `skills.${s}`),
  'strike.attack',
];

/**
 * A list, whatever arrived.
 *
 * `sheet.effects` is written by a player's browser and by the GM's, through a
 * patch endpoint that takes a path and a value and asks no questions about the
 * shape. The sheet is the player's to fill in, so this coerces rather than
 * refuses -- but it is never allowed to throw on the way to drawing a number.
 */
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * Everything that rolls off one attribute.
 *
 * This is what makes clumsy, enfeebled and stupefied one rule each rather than
 * a list of sixteen skills apiece: the sheet already knows which attribute
 * every skill and every strike uses, so the condition can say "Dexterity" and
 * mean it.
 */
function attributeTargets(attribute, { sheet = {}, strike = null } = {}) {
  const out = [];
  if (attribute === 'dex') out.push('ac', 'saves.reflex');
  if (attribute === 'con') out.push('saves.fortitude');
  if (attribute === 'wis') out.push('saves.will', 'perception');
  for (const skill of SKILLS) {
    if (SKILL_ATTRIBUTE[skill] === attribute) out.push(`skills.${skill}`);
  }
  if (attribute === 'int') out.push('skills.lore');
  // A class DC is the key attribute's, so an enfeebled fighter's goes down.
  if (String(sheet.keyAttribute ?? '') === attribute) out.push('classDc');
  /**
   * A strike is only this attribute's if this strike is.
   *
   * Clumsy names ranged attack rolls and enfeebled names Strength-based melee
   * ones, but both are illustrations of the same rule -- the roll is the
   * attribute's or it is not -- so this asks the strike rather than its range.
   * A rapier attacks with Dexterity and damages with Strength, and gets each
   * penalty from a different condition.
   */
  if (strike?.components?.attribute === attribute) out.push('strike.attack');
  if (strike?.components?.damageAttribute === attribute) out.push('strike.damage');
  return out;
}

/** Whether a modifier aimed at `wanted` lands on `target`. */
function hits(wanted, target, context) {
  const name = String(wanted ?? '');
  if (name === target) return true;
  // Lores are skills the list cannot name, so "every check" reaches them by
  // shape rather than by membership.
  if (name === 'all') return EVERY_CHECK.includes(target) || target.startsWith('skills.');
  if (name === 'saves') return target.startsWith('saves.');
  if (name === 'skills') return target.startsWith('skills.');
  if (name === 'strike') return target.startsWith('strike.');
  if (name.startsWith('attr:')) {
    return attributeTargets(name.slice(5), context).includes(target);
  }
  return false;
}

/**
 * The modifiers in play on one target, after stacking.
 *
 * `parts` is kept because the sheet shows its working everywhere else, and a
 * number that silently went down by two is the thing this feature exists to
 * stop happening.
 */
export function stack(modifiers = []) {
  const best = new Map();
  const untyped = [];

  for (const modifier of modifiers) {
    const value = Math.trunc(Number(modifier?.value ?? 0));
    if (!Number.isFinite(value) || value === 0) continue;
    const type = BONUS_TYPES.includes(modifier?.type) ? modifier.type : 'untyped';
    const part = { ...modifier, type, value };

    if (type === 'untyped') { untyped.push(part); continue; }

    // Bonuses and penalties of one type are two separate contests: a +1 status
    // and a -2 status both apply, and the character is at -1.
    const key = `${type}:${value > 0 ? 'bonus' : 'penalty'}`;
    const held = best.get(key);
    if (!held || Math.abs(value) > Math.abs(held.value)) best.set(key, part);
  }

  const parts = [...best.values(), ...untyped];
  return { total: parts.reduce((sum, part) => sum + part.value, 0), parts };
}

/**
 * What each condition does to a number, and the sentence it comes from.
 *
 * Written out rather than read from the condition table, which carries the
 * printed text and nothing machine-readable -- see the note at the top of
 * `src/rules/tables/conditions.js`. Every rule here quotes the text the table
 * already ships, so the two can be checked against each other by eye.
 *
 * Conditions that change what you may do rather than what you roll -- blinded,
 * confused, fleeing, grabbed, slowed, stunned, doomed, dying, wounded -- are
 * deliberately absent. They are real and they are not arithmetic.
 */
export const CONDITION_RULES = {
  // "a status penalty equal to this value to all your checks and DCs"
  frightened: (n) => [{ target: 'all', type: 'status', value: -n }],
  // "a status penalty equal to this value on all your checks and DCs"
  sickened: (n) => [{ target: 'all', type: 'status', value: -n }],
  // "to Dexterity-based rolls and DCs, including AC, Reflex saves, ranged
  // attack rolls, and skill checks using Acrobatics, Stealth, and Thievery"
  clumsy: (n) => [{ target: 'attr:dex', type: 'status', value: -n }],
  // "to Strength-based rolls and DCs, including Strength-based melee attack
  // rolls, Strength-based damage rolls, and Athletics checks"
  enfeebled: (n) => [{ target: 'attr:str', type: 'status', value: -n }],
  // "on Intelligence-, Wisdom-, and Charisma-based rolls and DCs"
  stupefied: (n) => ['int', 'wis', 'cha']
    .map((attribute) => ({ target: `attr:${attribute}`, type: 'status', value: -n })),
  // "on Constitution-based rolls and DCs, such as Fortitude saves." The hit
  // points it also costs are below, where the level is in hand.
  drained: (n) => [{ target: 'attr:con', type: 'status', value: -n }],
  // "a -2 circumstance penalty to AC"
  'off-guard': () => [{ target: 'ac', type: 'circumstance', value: -2 }],
  // "a -1 status penalty to AC and saving throws"
  fatigued: () => [
    { target: 'ac', type: 'status', value: -1 },
    { target: 'saves', type: 'status', value: -1 },
  ],
  // "you're Clumsy 1 and take a 10-foot penalty to all your Speeds"
  encumbered: () => [
    { target: 'attr:dex', type: 'status', value: -1 },
    { target: 'speed', type: 'untyped', value: -10 },
  ],
};

/** A condition list, as modifiers. Each one names itself, so the row can say why. */
function fromConditions(conditions) {
  const out = [];
  for (const condition of list(conditions)) {
    const slug = String(condition?.slug ?? '').trim();
    const rule = CONDITION_RULES[slug];
    if (!rule) continue;
    // A valued condition with no value is one somebody is mid-way through
    // typing. Treated as 1, which is what the rules say the minimum is.
    const value = Math.max(1, Math.trunc(Number(condition?.value ?? 1)) || 1);
    const label = condition?.value ? `${slug} ${value}` : slug;
    for (const modifier of rule(value)) out.push({ ...modifier, from: label, condition: slug });
  }
  return out;
}

/** The effect list a player wrote, as modifiers. Anything malformed is skipped. */
function fromEffects(effects) {
  const out = [];
  for (const effect of list(effects)) {
    if (!effect || typeof effect !== 'object' || effect.active === false) continue;
    const from = String(effect.name ?? '').trim() || 'Effect';
    for (const modifier of list(effect.modifiers)) {
      if (!modifier || typeof modifier !== 'object') continue;
      out.push({
        target: String(modifier.target ?? ''),
        type: modifier.type,
        value: modifier.value,
        from,
        effect: effect.id ?? null,
      });
    }
  }
  return out;
}

/**
 * Everything in play on this sheet.
 *
 * Built once and asked many times: a skills card asks sixteen questions of the
 * same list, and rebuilding it per row is how a sheet starts feeling slow on a
 * phone.
 */
export function effectsOn(sheet = {}) {
  const modifiers = [...fromEffects(sheet.effects), ...fromConditions(sheet.conditions)];

  const level = Math.max(1, Math.trunc(Number(sheet.level ?? 1)) || 1);
  const drained = list(sheet.conditions)
    .find((condition) => String(condition?.slug ?? '') === 'drained');
  const drainedValue = drained ? Math.max(1, Math.trunc(Number(drained.value ?? 1)) || 1) : 0;

  return {
    /** Whether anything is in play at all, so a quiet sheet pays nothing. */
    any: modifiers.length > 0 || drainedValue > 0,

    /** The names, for a row that says what is running. */
    names: [
      ...list(sheet.effects)
        .filter((e) => e && typeof e === 'object' && e.active !== false)
        .map((e) => String(e.name ?? '').trim() || 'Effect'),
      ...list(sheet.conditions)
        .filter((c) => CONDITION_RULES[String(c?.slug ?? '')])
        .map((c) => (c.value ? `${c.slug} ${c.value}` : String(c.slug))),
    ],

    on(target, context = {}) {
      return stack(modifiers.filter((m) => hits(m.target, target, { sheet, ...context })));
    },

    /**
     * "You also lose a number of Hit Points equal to your level (minimum 1)
     * times the drained value, and your maximum Hit Points are reduced by the
     * same amount."
     */
    hpMaxPenalty: drainedValue ? -(level * drainedValue) : 0,
  };
}
