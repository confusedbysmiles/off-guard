/**
 * Every choice a character has, in the order they are made.
 *
 * This is the timeline the builder renders and the thing that makes planning
 * work. A slot is a decision -- "your level 6 class feat", "your level 5
 * attribute boosts" -- and it exists whether or not it has been filled, and
 * whether or not the character has reached that level yet. A player mapping out
 * level 12 on the train is filling slots above their level; nothing about that
 * is a different code path from filling the ones below it.
 *
 * Slots carry the filter that answers them, so the interface never has to know
 * that a class feat is chosen from `category: 'class'` narrowed by the class's
 * own trait. Asking "what can go here" is a property of the slot.
 *
 * The levels come from the class document -- `classFeatLevels`,
 * `skillIncreaseLevels` and the rest are printed facts upstream states per
 * class -- so a class that gives feats on an unusual schedule needs nothing
 * here.
 */
import { BOOST_LEVELS, BOOSTS_PER_LEVEL } from './attributes.js';

export const MAX_LEVEL = 20;

/** What a slot is waiting for, and what the interface should call it. */
const FEAT_KINDS = [
  ['class', 'classFeat', 'Class feat'],
  ['ancestry', 'ancestryFeat', 'Ancestry feat'],
  ['skill', 'skillFeat', 'Skill feat'],
  ['general', 'generalFeat', 'General feat'],
];

/**
 * A slot's id is `<kind>-<level>` and is what the build document keys its
 * choices by. Stable across everything except a class change, which is exactly
 * when the slots genuinely are different ones.
 */
export const slotId = (kind, level) => `${kind}-${level}`;

/**
 * Which ancestry and background boosts are the player's to choose.
 *
 * A fixed boost is not a choice and gets no slot: a dwarf's Constitution is
 * simply theirs. Only the free entries become decisions, which is why a dwarf
 * shows one boost to pick and a human shows two.
 */
function identitySlots(build, { ancestry, background, klass }) {
  const slots = [];

  slots.push({
    id: 'ancestry', level: 1, kind: 'ancestry', label: 'Ancestry',
    filled: build.ancestry ?? null, filter: { kind: 'ancestry' },
  });
  slots.push({
    id: 'heritage', level: 1, kind: 'heritage', label: 'Heritage',
    filled: build.heritage ?? null,
    // A heritage belongs to one ancestry, except the versatile ones, which
    // belong to none and are offered to everybody.
    filter: { kind: 'heritage', ancestry: ancestry?.id ?? null },
    blockedBy: ancestry ? null : 'ancestry',
  });
  slots.push({
    id: 'background', level: 1, kind: 'background', label: 'Background',
    filled: build.background ?? null, filter: { kind: 'background' },
  });
  slots.push({
    id: 'class', level: 1, kind: 'class', label: 'Class',
    filled: build.class ?? null, filter: { kind: 'class' },
  });

  const freeAncestryBoosts = (ancestry?.boosts ?? []).filter((b) => b.free);
  if (freeAncestryBoosts.length) {
    slots.push({
      id: 'ancestry-boosts', level: 1, kind: 'attributeBoosts', label: 'Ancestry attribute boosts',
      section: 'ancestry', count: freeAncestryBoosts.length,
      filled: build.attributes?.ancestry ?? [],
      options: freeAncestryBoosts.map((b) => b.options),
    });
  }

  const freeBackgroundBoosts = background?.boosts ?? [];
  if (freeBackgroundBoosts.length) {
    slots.push({
      id: 'background-boosts', level: 1, kind: 'attributeBoosts', label: 'Background attribute boosts',
      section: 'background', count: freeBackgroundBoosts.length,
      filled: build.attributes?.background ?? [],
      options: freeBackgroundBoosts.map((b) => b.options),
    });
  }

  if (klass) {
    slots.push({
      id: 'key-attribute', level: 1, kind: 'keyAttribute', label: 'Key attribute',
      filled: build.attributes?.class ?? null,
      options: [klass.keyAttributes ?? []],
    });
  }

  return slots;
}

/**
 * How many skills the player trains at level 1.
 *
 * The class allowance plus Intelligence, which means this slot's size changes
 * when a boost changes -- and that is worth surfacing rather than hiding, since
 * a player who raises Intelligence at level 5 genuinely does get another skill.
 */
function skillSlot(build, { klass, intMod }) {
  const count = Number(klass?.trainedSkills?.additional ?? 0) + Math.max(0, intMod);
  if (!count) return [];
  return [{
    id: 'trained-skills', level: 1, kind: 'trainedSkills', label: 'Trained skills',
    count, filled: build.skills?.trained ?? [],
    filter: { kind: 'skill' },
  }];
}

/**
 * The whole timeline.
 *
 * @param {object} build
 * @param {object} options
 * @param {number} options.level    the character's current level
 * @param {number} options.planTo   how far ahead to generate slots; defaults to
 *                                  the current level, so planning is opt-in
 * @returns {{slots: object[], byLevel: object}}
 */
export function slotsFor(build = {}, {
  ancestry = null, background = null, klass = null, intMod = 0,
  level = null, planTo = null,
} = {}) {
  const current = Math.max(1, Math.min(MAX_LEVEL, Number(level ?? build.level ?? 1)));
  const horizon = Math.max(current, Math.min(MAX_LEVEL, Number(planTo ?? build.planTo ?? current)));

  const slots = [
    ...identitySlots(build, { ancestry, background, klass }),
    ...skillSlot(build, { klass, intMod }),
  ];

  // Attribute boosts, four at a time, at the five levels every class shares.
  for (const boostLevel of BOOST_LEVELS) {
    if (boostLevel === 1 || boostLevel > horizon) continue;
    slots.push({
      id: slotId('boosts', boostLevel), level: boostLevel, kind: 'attributeBoosts',
      label: `Attribute boosts`, section: boostLevel, count: BOOSTS_PER_LEVEL,
      filled: build.attributes?.[boostLevel] ?? [],
      options: Array.from({ length: BOOSTS_PER_LEVEL }, () => null), // null: any attribute
    });
  }
  // Level 1's four free boosts sit with the identity choices rather than after
  // them, because that is the order the character is actually made in.
  slots.push({
    id: slotId('boosts', 1), level: 1, kind: 'attributeBoosts',
    label: 'Attribute boosts', section: 1, count: BOOSTS_PER_LEVEL,
    filled: build.attributes?.[1] ?? [],
    options: Array.from({ length: BOOSTS_PER_LEVEL }, () => null),
  });

  // Feats, on whatever schedule this class prints.
  for (const [key, kind, label] of FEAT_KINDS) {
    for (const featLevel of klass?.featLevels?.[key] ?? []) {
      if (featLevel > horizon) continue;
      slots.push({
        id: slotId(kind, featLevel), level: featLevel, kind, label,
        filled: build.feats?.[slotId(kind, featLevel)] ?? null,
        filter: {
          kind: 'feat',
          category: key,
          // A class feat is narrowed by the class's own trait; the others are
          // open to everyone, and an ancestry feat by the ancestry's trait.
          ...(key === 'class' && klass ? { trait: slugOf(klass.name) } : {}),
          ...(key === 'ancestry' && ancestry ? { trait: slugOf(ancestry.name) } : {}),
          maxLevel: featLevel,
        },
      });
    }
  }

  for (const increaseLevel of klass?.skillIncreaseLevels ?? []) {
    if (increaseLevel > horizon) continue;
    slots.push({
      id: slotId('skillIncrease', increaseLevel), level: increaseLevel, kind: 'skillIncrease',
      label: 'Skill increase',
      filled: build.skills?.increases?.[increaseLevel]
        ?? build.skills?.increases?.[String(increaseLevel)] ?? null,
      filter: { kind: 'skill' },
    });
  }

  for (const slot of slots) {
    // The one distinction the interface needs everywhere: is this a decision
    // that is live, or one the character has not reached yet?
    slot.planned = slot.level > current;
    slot.empty = Array.isArray(slot.filled)
      ? slot.filled.length < (slot.count ?? 1)
      : (slot.filled === null || slot.filled === undefined || slot.filled === '');
  }

  slots.sort((a, b) => a.level - b.level || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const byLevel = {};
  for (const slot of slots) (byLevel[slot.level] ??= []).push(slot);

  return { slots, byLevel, level: current, planTo: horizon };
}

/** Within a level, the order a character is actually built in. */
const ORDER = [
  'ancestry', 'heritage', 'background', 'class', 'keyAttribute',
  'attributeBoosts', 'trainedSkills', 'classFeat', 'ancestryFeat',
  'skillFeat', 'generalFeat', 'skillIncrease',
];

/** A trait slug from a printed name: "Fighter" -> "fighter". */
const slugOf = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * What is still to be decided at or below a level.
 * The number the interface puts on a level-up button, and the one the GM's
 * party panel shows as "three choices outstanding".
 */
export function outstanding(slots, level = MAX_LEVEL) {
  return slots.filter((slot) => slot.empty && slot.level <= level);
}
