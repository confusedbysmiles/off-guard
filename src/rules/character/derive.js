/**
 * A build document -> a character sheet.
 *
 * This is the piece that makes the builder integrate with everything else for
 * free. The GM's party panel, the encounter budget and the initiative tracker
 * all read the same sheet paths they already read; a character built here is
 * indistinguishable from one typed in by hand or imported from Pathbuilder,
 * because it lands on exactly the paths `mapPathbuilder` produces.
 *
 * The rule about levels runs through the whole file: a choice recorded for a
 * level above the character's current one is a *plan*. It is stored, it is
 * shown, and it contributes nothing to a single number until the character
 * reaches that level. That is what lets a player map out level 12 on the train
 * without their sheet changing tonight.
 *
 * What is derived and what is not:
 *
 *   Derived, and owned by the build: attributes, proficiency ranks, hit points,
 *   speed, languages, size, and the identity fields.
 *
 *   Not derived: current hit points, conditions, hero points, spent slots and
 *   focus. Play state belongs to the table, and rebuilding a character should
 *   no more heal them than re-importing one does.
 *
 *   Not attempted: what a feat mechanically does. Feats land on the sheet as
 *   named entries with their text and their action cost. Upstream encodes their
 *   effects only as Foundry rule elements, which are a runtime automation
 *   language, and a builder that half-evaluated them would be wrong in ways
 *   nobody could see. The numbers a feat changes stay manual adjustments --
 *   which is how the sheet has always worked, and every field on it already
 *   accepts one.
 */
import { attributeModifiers, boostProblems } from './attributes.js';
import { encumbrance } from './bulk.js';
import {
  armorClassFrom, carriedTenths, customArmor, customShield, customWeapon,
  gearRows, recordFor, shieldFrom, strikeFrom,
} from './equipment.js';

export const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

export const SKILL_ATTRIBUTE = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
  deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
  society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
};

const RANK_ORDER = ['untrained', 'trained', 'expert', 'master', 'legendary'];
const rankIndex = (rank) => Math.max(0, RANK_ORDER.indexOf(String(rank ?? 'untrained')));

/** Proficiency only ever goes up. Two features raising the same rank is not a bug. */
const higher = (a, b) => (rankIndex(a) >= rankIndex(b) ? a : b);

/**
 * The earliest level a skill may reach each rank.
 * Player Core, Skill Increases: expert at 3rd, master at 7th, legendary at 15th.
 */
const SKILL_RANK_MINIMUM = { expert: 3, master: 7, legendary: 15 };

/**
 * Walk the class's advancement table up to `level`, carrying ranks forward.
 *
 * `progression.byLevel` holds only what changes at each level, so a rank that
 * is never mentioned again keeps the value the class started with -- which is
 * the correct reading and also the safe one, since an advancement this
 * application failed to recognize leaves a proficiency flat rather than moving
 * it somewhere invented.
 */
export function proficienciesAt(progression, level) {
  const initial = progression?.initial ?? {};
  const result = {
    perception: initial.perception ?? 'untrained',
    classDc: initial.classDc ?? 'untrained',
    spellcasting: initial.spellcasting ?? 'untrained',
    saves: { ...(initial.saves ?? {}) },
    attacks: { ...(initial.attacks ?? {}) },
    defenses: { ...(initial.defenses ?? {}) },
    weaponSpecialization: null,
  };

  for (let l = 1; l <= Number(level ?? 1); l += 1) {
    const at = progression?.byLevel?.[l] ?? progression?.byLevel?.[String(l)];
    if (!at) continue;
    if (at.perception) result.perception = higher(result.perception, at.perception);
    if (at.classDc) result.classDc = higher(result.classDc, at.classDc);
    if (at.spellcasting) result.spellcasting = higher(result.spellcasting, at.spellcasting);
    if (at.weaponSpecialization) result.weaponSpecialization = at.weaponSpecialization;
    for (const [save, rank] of Object.entries(at.saves ?? {})) {
      result.saves[save] = higher(result.saves[save], rank);
    }
    for (const [key, rank] of Object.entries(at.attacks ?? {})) {
      result.attacks[key] = higher(result.attacks[key], rank);
    }
    for (const [key, rank] of Object.entries(at.defenses ?? {})) {
      result.defenses[key] = higher(result.defenses[key], rank);
    }
  }

  return result;
}

/**
 * Skill ranks.
 *
 * Trained skills come from three places that can overlap -- the background, the
 * class's fixed list, and the player's own choices -- and a skill trained twice
 * is a wasted choice rather than an error, so overlaps are counted and reported
 * rather than rejected.
 */
export function skillRanks(build, { klass, background, intMod = 0, level = 1 }) {
  const ranks = Object.fromEntries(SKILLS.map((s) => [s, 'untrained']));
  const problems = [];

  const train = (skill) => {
    if (!SKILLS.includes(skill)) return false;
    const already = ranks[skill] !== 'untrained';
    ranks[skill] = higher(ranks[skill], 'trained');
    return already;
  };

  for (const skill of background?.trainedSkills ?? []) train(skill);
  for (const skill of klass?.trainedSkills?.fixed ?? []) train(skill);

  /**
   * How many skills the player picks: the class's own allowance plus their
   * Intelligence modifier. A negative Intelligence does not take skills away.
   */
  const allowance = Number(klass?.trainedSkills?.additional ?? 0) + Math.max(0, intMod);
  const chosen = (build.skills?.trained ?? []).filter((s) => SKILLS.includes(s));

  for (const skill of chosen) {
    if (train(skill)) {
      problems.push({
        kind: 'redundant-skill', skill, section: 'skills',
        message: `${titleCase(skill)} is already trained by your ${background?.trainedSkills?.includes(skill) ? 'background' : 'class'}. Choose another skill instead.`,
      });
    }
  }

  if (chosen.length < allowance) {
    problems.push({
      kind: 'incomplete', section: 'skills', got: chosen.length, want: allowance,
      message: `${allowance - chosen.length} more trained ${allowance - chosen.length === 1 ? 'skill' : 'skills'} to choose.`,
    });
  } else if (chosen.length > allowance) {
    problems.push({
      kind: 'excess', section: 'skills', got: chosen.length, want: allowance,
      message: `${chosen.length - allowance} too many trained skills.`,
    });
  }

  /**
   * Skill increases, in level order, each raising one skill by one rank. Order
   * matters: two increases to the same skill are what take it from trained to
   * expert to master, and applying them out of order would cap it early.
   */
  const increaseLevels = (klass?.skillIncreaseLevels ?? []).filter((l) => l <= level);
  for (const increaseLevel of [...increaseLevels].sort((a, b) => a - b)) {
    const skill = build.skills?.increases?.[increaseLevel] ?? build.skills?.increases?.[String(increaseLevel)];
    if (!skill) continue;
    if (!SKILLS.includes(skill)) continue;

    const next = RANK_ORDER[Math.min(rankIndex(ranks[skill]) + 1, RANK_ORDER.length - 1)];
    const minimum = SKILL_RANK_MINIMUM[next];
    if (minimum && increaseLevel < minimum) {
      problems.push({
        kind: 'too-early', section: `level ${increaseLevel}`, skill, rank: next,
        message: `${titleCase(skill)} cannot become ${next} until level ${minimum}.`,
      });
      continue;
    }
    ranks[skill] = next;
  }

  return { ranks, problems, allowance, chosen };
}

const titleCase = (s) => String(s ?? '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The boosts an ancestry or background grants outright, with no choice in it. */
const fixedBoosts = (record) => (record?.boosts ?? [])
  .filter((boost) => !boost.free)
  .map((boost) => boost.options[0])
  .filter(Boolean);

/** The boosts it leaves to the player. */
const freeBoosts = (record) => (record?.boosts ?? []).filter((boost) => boost.free);

/**
 * Hit points.
 *
 * Ancestry once, then class-plus-Constitution every level. Constitution is
 * applied per level rather than once, which is the mistake that makes a level
 * 10 character short by nine times their Constitution modifier.
 */
export function hitPoints({ ancestry, klass, conMod, level, bonusPerLevel = 0, bonus = 0 }) {
  return Number(ancestry?.hp ?? 0)
    + (Number(klass?.hp ?? 0) + Number(conMod)) * Number(level)
    + Number(bonusPerLevel) * Number(level)
    + Number(bonus);
}

/**
 * The whole derivation.
 *
 * @param {object} build     the choices, as stored at `sheet.build`
 * @param {object} options   the resolved option records the build points at.
 *   Passing them in rather than looking them up keeps this module free of the
 *   catalogue, and therefore free of the filesystem -- `src/rules/` runs
 *   unchanged in the browser and on the server, which is the whole reason the
 *   arithmetic lives here and not in either one.
 * @returns {{sheet: object, problems: object[], proficiencies: object}}
 */
export function deriveCharacter(build = {}, {
  ancestry = null, heritage = null, background = null, klass = null, progression = null,
  items = {},
} = {}) {
  const level = Math.max(1, Math.min(20, Number(build.level ?? 1)));
  const problems = [];

  /**
   * A fixed boost is not a choice and the build does not store it. A dwarf's
   * Constitution is simply theirs, so it is composed in here rather than
   * requiring the interface to send back something the player never picked --
   * which would mean a build could lose it, and lose two hit points per level
   * with it.
   */
  const attributes = {
    ...(build.attributes ?? {}),
    ancestry: [...fixedBoosts(ancestry), ...(build.attributes?.ancestry ?? [])],
    background: [...fixedBoosts(background), ...(build.attributes?.background ?? [])],
  };

  const { mods, exact } = attributeModifiers(attributes, {
    flaws: ancestry?.flaws ?? [],
    apex: build.apex ?? null,
    level,
  });

  // Counted against the free boosts alone, for the same reason: the player is
  // only ever asked for the ones they choose.
  problems.push(...boostProblems(build.attributes ?? {}, {
    ancestryBoosts: freeBoosts(ancestry),
    backgroundBoosts: freeBoosts(background),
    level,
  }));

  const proficiencies = proficienciesAt(progression, level);

  const skills = skillRanks(build, {
    klass, background, intMod: mods.int, level,
  });
  problems.push(...skills.problems);

  /**
   * Lores are named rather than chosen from a list, so they are kept whole:
   * the background's ("Scribing Lore") plus any the player added.
   */
  const lores = [
    ...(background?.trainedLore ?? []).map((name) => ({ name, rank: 'trained' })),
    ...(build.skills?.lores ?? []).map((lore) => ({
      name: String(lore?.name ?? lore ?? ''),
      rank: lore?.rank ?? 'trained',
    })).filter((lore) => lore.name),
  ];

  const speed = Number(ancestry?.speed ?? 25) + Number(build.speedBonus ?? 0);

  const worn = build.equipment?.armor ?? null;
  const armorClass = armorClassFrom({
    armor: recordFor(worn, items, customArmor),
    worn,
    proficiencies,
    dexMod: mods.dex,
    level,
  });

  /**
   * Strikes, in the order the player listed them. A weapon whose catalogue
   * entry has gone still produces a row -- named, with no numbers -- because a
   * strike vanishing off a sheet mid-campaign is worse than one that says it
   * needs attention.
   */
  const strikes = (build.equipment?.weapons ?? []).map((entry) => strikeFrom(entry, {
    weapon: recordFor(entry, items, customWeapon),
    proficiencies,
    mods,
    level,
    specialization: proficiencies.weaponSpecialization,
  }));

  if (worn?.id && !items[worn.id]) {
    problems.push({
      kind: 'missing-item', section: 'equipment', id: worn.id,
      message: 'The armour on this character is not in the catalogue, so its AC is not counted.',
    });
  }
  for (const entry of build.equipment?.weapons ?? []) {
    if (entry?.id && !items[entry.id]) {
      problems.push({
        kind: 'missing-item', section: 'equipment', id: entry.id,
        message: `${entry.name || entry.id} is not in the catalogue, so its numbers are not worked out.`,
      });
    }
  }

  /**
   * What is carried, and what it weighs.
   *
   * A shield is recorded rather than folded into AC -- see `shieldFrom` -- and
   * the gear list is the player's own, so neither changes a number that was
   * right before. Bulk is the one thing they do produce, and it is advisory:
   * `encumbrance` reports the two thresholds and whether they are past, and
   * nothing anywhere refuses to save because of it.
   */
  const shieldEntry = build.equipment?.shield ?? null;
  const shield = shieldEntry
    ? shieldFrom(shieldEntry, recordFor(shieldEntry, items, customShield))
    : null;
  const gear = gearRows(build.equipment?.gear ?? [], items);
  const coins = Object.fromEntries(['pp', 'gp', 'sp', 'cp']
    .map((key) => [key, Math.max(0, Math.trunc(Number(build.coins?.[key] ?? 0)) || 0)]));
  const bulk = encumbrance(carriedTenths({
    armor: worn,
    shield: shieldEntry,
    weapons: build.equipment?.weapons ?? [],
    gear: build.equipment?.gear ?? [],
    coins,
    items,
  }), mods.str);

  for (const row of gear) {
    if (!row.missing) continue;
    problems.push({
      kind: 'missing-item', section: 'equipment', id: row.id,
      message: `${row.name} is not in the catalogue, so its Bulk is not counted.`,
    });
  }
  if (shieldEntry?.id && !items[shieldEntry.id]) {
    problems.push({
      kind: 'missing-item', section: 'equipment', id: shieldEntry.id,
      message: 'The shield on this character is not in the catalogue, so its numbers are not shown.',
    });
  }

  const sheet = {
    level,
    ancestry: ancestry?.name ?? '',
    heritage: heritage?.name ?? '',
    background: background?.name ?? '',
    class: klass?.name ?? '',
    keyAttribute: String(build.attributes?.class ?? ''),
    size: ancestry?.sizeName ?? '',
    abilities: mods,
    classDc: { rank: proficiencies.classDc },
    perception: { rank: proficiencies.perception },
    saves: {
      fortitude: { rank: proficiencies.saves.fortitude ?? 'untrained' },
      reflex: { rank: proficiencies.saves.reflex ?? 'untrained' },
      will: { rank: proficiencies.saves.will ?? 'untrained' },
    },
    skills: Object.fromEntries(SKILLS.map((skill) => [skill, { rank: skills.ranks[skill] }])),
    lores,
    languages: [
      ...(ancestry?.languages ?? []),
      ...(build.languages ?? []),
    ].filter((v, i, all) => all.indexOf(v) === i),
    speed: speed + Number(armorClass.speedPenalty ?? 0),
    /**
     * Armour Class, from the armour actually worn -- or from unarmoured
     * defence, which is a proficiency of its own and trained from level 1 for
     * most classes rather than an absence of one.
     */
    ac: {
      rank: armorClass.rank,
      dexCap: armorClass.dexCap,
      itemBonus: armorClass.itemBonus,
    },
    strikes,
    gear,
    coins,
    bulk,
    hp: {
      max: hitPoints({
        ancestry, klass, conMod: mods.con, level,
        bonusPerLevel: build.hpPerLevel ?? 0,
        bonus: build.hpBonus ?? 0,
      }),
    },
    focus: { pool: Number(build.focusPool ?? 0) },
  };

  // A name only when the build has one: a character can exist before it is
  // named, and overwriting the sheet's name with an empty string is how the
  // roster loses track of whose row is whose.
  if (build.name) sheet.name = String(build.name);

  // A shield only when the build has one, for the same reason and one more:
  // the sheet has had shield fields since long before the builder, and a build
  // that says nothing about a shield must not reach over and empty them.
  if (shield) sheet.shield = shield;

  return {
    sheet,
    problems,
    proficiencies,
    attributes: { mods, exact },
    skillAllowance: { want: skills.allowance, got: skills.chosen.length },
  };
}

/**
 * Whether the build owns a path.
 *
 * A prefix match, not equality: the derivation owns `lores` as a whole, and the
 * sheet binds `lores.0.rank`. Without the prefix the sheet would leave the
 * individual rows editable and then overwrite them on the next save, which is
 * the silent kind of wrong this check exists to prevent.
 */
export function isDerivedPath(path, build = null) {
  const target = String(path ?? '');
  /**
   * The name is owned only once the build has one. The derivation deliberately
   * does not emit an empty name -- a character can exist before it is named --
   * so locking the sheet's field on an unnamed build would leave no way to name
   * them at all.
   */
  if (target === 'name') return Boolean(build?.name);

  /**
   * Raising a shield is an action taken at the table, so that box is the
   * player's on every character, built or not.
   *
   * The rest of the shield's fields are the build's only while it names a
   * shield. Somebody who typed one onto their sheet before there was a builder
   * keeps it, and somebody who takes theirs off gets their fields back rather
   * than a row of zeros they are not allowed to correct.
   */
  if (target === 'shield.raised') return false;
  if (target.startsWith('shield.')) return hasShield(build);

  const owned = DERIVED_PATHS.find((path) => target === path || target.startsWith(`${path}.`));
  if (!owned) return false;

  /**
   * And only once the build actually says something about it.
   *
   * This is the rule the shield already followed, applied to everything else.
   * Without it a build owns a path whether or not it determines one -- so a
   * character imported from Pathbuilder, who has a full sheet and no build,
   * lost their class, their hit points, their money and their whole bag the
   * first time anyone opened the builder and clicked once. The derivation of
   * an empty build is not a set of facts about the character; it is a row of
   * zeroes, and writing zeroes over somebody's character is the worst thing
   * this application could do quietly.
   *
   * Stated as "which part of the build has to exist first", because that is
   * the question in every case and the answer is always a field the player
   * can see.
   */
  const needed = REQUIRED_FOR[owned];
  return needed ? Boolean(needed(build ?? {})) : true;
}

const hasShield = (build) => Boolean(build?.equipment?.shield?.id || build?.equipment?.shield?.custom);

const some = (list) => Array.isArray(list) && list.length > 0;

/**
 * Whether anybody has started building this character.
 *
 * Four questions, and until one of them has an answer there is no build --
 * only the empty document every character carries. `level` hangs off this
 * rather than being always-owned: a blank build's level is 1, and writing 1
 * over an imported level 6 is the same silent loss as writing 0 over their
 * gold.
 */
const started = (b) => Boolean(b.ancestry || b.heritage || b.background || b.class);

/**
 * What the build must name before it owns each path.
 *
 * A path absent from here is owned as soon as there is a build at all --
 * `level` and `bulk`, which a build always determines.
 *
 * Two of these are deliberately asymmetric, and the asymmetry is the point.
 * `coins` is the build's once the build has any money in it, and `gear` once
 * it has anything in the bag: a purse emptied to zero in the builder therefore
 * does not clear a purse that came from an import. That costs a player who
 * genuinely spends down to nothing one manual edit on the sheet. The other way
 * round costs them 187 gold without asking, which is not a trade.
 */
const REQUIRED_FOR = {
  name: (b) => b.name,
  level: started,
  bulk: started,
  ancestry: (b) => b.ancestry,
  size: (b) => b.ancestry,
  speed: (b) => b.ancestry,
  languages: (b) => b.ancestry,
  heritage: (b) => b.heritage,
  background: (b) => b.background,
  class: (b) => b.class,
  keyAttribute: (b) => b.class,
  'hp.max': (b) => b.class,
  'classDc.rank': (b) => b.class,
  'perception.rank': (b) => b.class,
  'saves.fortitude.rank': (b) => b.class,
  'saves.reflex.rank': (b) => b.class,
  'saves.will.rank': (b) => b.class,
  'focus.pool': (b) => b.class,
  ...Object.fromEntries(SKILLS.map((skill) => [`skills.${skill}.rank`, (b) => b.class])),
  // Every boost comes from one of these three; with none of them the modifiers
  // are six zeroes.
  abilities: started,
  'ac.rank': (b) => b.class || b.equipment?.armor,
  'ac.dexCap': (b) => b.class || b.equipment?.armor,
  'ac.itemBonus': (b) => b.class || b.equipment?.armor,
  strikes: (b) => some(b.equipment?.weapons),
  gear: (b) => some(b.equipment?.gear),
  coins: (b) => Object.values(b.coins ?? {}).some((n) => Number(n) > 0),
  lores: (b) => some(b.skills?.lores) || b.background,
};

/** The paths `deriveCharacter` owns. Anything else on the sheet is the player's. */
export const DERIVED_PATHS = [
  // `subclass` is deliberately absent: a bloodline, doctrine or instinct is a
  // real choice the builder does not offer yet, and deriving it would lock the
  // sheet's field while leaving nowhere to set it. It stays the player's until
  // there is a slot for it.
  'name',
  'level', 'ancestry', 'heritage', 'background', 'class',
  'keyAttribute', 'size', 'abilities', 'classDc.rank', 'perception.rank',
  'saves.fortitude.rank', 'saves.reflex.rank', 'saves.will.rank',
  'ac.rank', 'ac.dexCap', 'ac.itemBonus',
  ...SKILLS.map((s) => `skills.${s}.rank`),
  'lores', 'languages', 'speed', 'hp.max', 'focus.pool', 'strikes',
  // What the character carries. Two things are deliberately absent. `items` is
  // the free-text box the sheet has always had: it predates the builder, an
  // imported character still uses it, and overwriting somebody's notes with a
  // list they did not make there would be the worst kind of helpful. And
  // `shield.raised` is the player's, pressed at the table -- so the shield's
  // leaves are named one at a time rather than owning the object they are in.
  'shield.name', 'shield.bonus', 'shield.hardness', 'shield.hp', 'shield.breakThreshold',
  'gear', 'coins', 'bulk',
];
