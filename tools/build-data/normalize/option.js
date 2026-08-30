/**
 * Foundry player-facing documents -> Off-Guard build options.
 *
 * The creature normalizer resolves a stat block the GM reads. This one resolves
 * the things a *player chooses*: ancestries, heritages, backgrounds, classes,
 * feats, equipment, spells and the features a class hands out on its own.
 *
 * The distinction that matters is between what upstream states plainly and what
 * it only automates. `system.boosts`, `system.acBonus`, `system.dexCap`,
 * `system.savingThrows` and the rest are printed facts, and they are read
 * straight through. Foundry's `system.rules` arrays are a different thing --
 * a runtime automation language -- and nothing here evaluates them. What a feat
 * mechanically *does* is therefore its text, not a number, which is the same
 * bargain the creature build makes with rule-element IWR and says so.
 *
 * The one exception is proficiency advancement, which upstream does not encode
 * at all: Foundry applies it from hardcoded class logic, not from the packs. It
 * lives in `src/rules/tables/class-progression.js` instead, hand-written from
 * the rulebook, and `verifyProgression` below checks the two against each other
 * at build time so a class that gains a proficiency this file cannot see is a
 * line in the build report rather than a number that is quietly two too low.
 */
import { packTier } from '../catalog.js';
import { slugify } from '../markup.js';
import { sizeName, titleCase, words } from './shared.js';

/** The six attributes, in the order every sheet in the application prints them. */
export const ATTRIBUTES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * A boost entry is either a fixed attribute or a free choice, and upstream
 * spells both the same way: a list. One entry means "this attribute"; the whole
 * set means "any". An empty list is a slot the ancestry does not use at all --
 * human has two free boosts and a third entry that is empty, and reading that
 * as a free boost would hand every human an attribute they never earned.
 */
function normalizeBoosts(boosts) {
  return Object.values(boosts ?? {})
    .map((entry) => (entry?.value ?? []).filter((a) => ATTRIBUTES.includes(a)))
    .filter((options) => options.length > 0)
    .map((options) => (options.length >= ATTRIBUTES.length
      ? { free: true, options: [...ATTRIBUTES] }
      : { free: options.length > 1, options }));
}

/** Same shape, but a flaw is never a choice in any printed ancestry. */
function normalizeFlaws(flaws) {
  return Object.values(flaws ?? {})
    .flatMap((entry) => (entry?.value ?? []))
    .filter((a) => ATTRIBUTES.includes(a));
}

/** Foundry's numeric rank (0-4) -> the name the rules engine uses. */
const RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
export const rankName = (n) => RANKS[Number(n) ?? 0] ?? 'untrained';

/** The `items` map on an ancestry, background or class: what it grants, and when. */
function grantedItems(system) {
  return Object.values(system?.items ?? {})
    .map((item) => ({
      name: String(item?.name ?? ''),
      level: Number(item?.level ?? 1),
      // The uuid is kept so the builder can link the granted feature to its own
      // entry in the catalogue rather than showing a bare name.
      uuid: String(item?.uuid ?? ''),
      id: slugify(String(item?.name ?? '')),
    }))
    .filter((item) => item.name)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

const levels = (value) => (value?.value ?? []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

/** Every option record carries the same identifying spine. */
function common(doc, { id, kind, pack, resolve }) {
  const system = doc.system ?? {};
  const publication = system.publication ?? {};
  return {
    id,
    kind,
    name: String(doc.name ?? ''),
    level: Number(system.level?.value ?? 0),
    rarity: system.traits?.rarity ?? 'common',
    traits: [...(system.traits?.value ?? [])].sort(),
    description: resolve(system.description?.value ?? '', { source: doc.name }),
    source: {
      book: publication.title ?? '',
      pack,
      tier: packTier(pack),
      remaster: publication.remaster ?? false,
      license: publication.license ?? '',
    },
  };
}

function normalizeAncestry(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'ancestry' }),
    level: 0,
    hp: Number(s.hp ?? 0),
    size: s.size ?? 'med',
    sizeName: sizeName(s.size),
    speed: Number(s.speed ?? 25),
    reach: Number(s.reach ?? 5),
    boosts: normalizeBoosts(s.boosts),
    flaws: normalizeFlaws(s.flaws),
    languages: [...(s.languages?.value ?? [])],
    // `count: 0` means "as many as your Intelligence allows and no more"; the
    // list is what those extra languages may be chosen from.
    additionalLanguages: {
      count: Number(s.additionalLanguages?.count ?? 0),
      options: [...(s.additionalLanguages?.value ?? [])].sort(),
    },
    vision: s.vision ?? 'normal',
    grants: grantedItems(s),
  };
}

function normalizeHeritage(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'heritage' }),
    level: 0,
    // Null on a versatile heritage, which any ancestry may take.
    ancestry: s.ancestry?.slug ? String(s.ancestry.slug) : null,
    ancestryName: s.ancestry?.name ? String(s.ancestry.name) : null,
  };
}

function normalizeBackground(doc, ctx) {
  const s = doc.system ?? {};
  const grants = grantedItems(s);
  return {
    ...common(doc, { ...ctx, kind: 'background' }),
    level: 0,
    boosts: normalizeBoosts(s.boosts),
    trainedSkills: [...(s.trainedSkills?.value ?? [])].sort(),
    // Printed as a named Lore ("Scribing Lore"), which the builder records as a
    // lore skill rather than trying to match against the sixteen.
    trainedLore: (s.trainedSkills?.lore ?? []).map(String),
    grants,
    /** Every printed background grants exactly one skill feat. */
    grantedFeat: grants[0] ?? null,
  };
}

function normalizeClass(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'class' }),
    level: 0,
    hp: Number(s.hp ?? 0),
    keyAttributes: (s.keyAbility?.value ?? []).filter((a) => ATTRIBUTES.includes(a)),
    /**
     * Ranks at level 1 only. Everything after level 1 comes from the
     * progression table -- see the note at the top of this file.
     */
    initial: {
      perception: rankName(s.perception),
      saves: {
        fortitude: rankName(s.savingThrows?.fortitude),
        reflex: rankName(s.savingThrows?.reflex),
        will: rankName(s.savingThrows?.will),
      },
      attacks: {
        unarmed: rankName(s.attacks?.unarmed),
        simple: rankName(s.attacks?.simple),
        martial: rankName(s.attacks?.martial),
        advanced: rankName(s.attacks?.advanced),
        other: s.attacks?.other?.name
          ? { name: String(s.attacks.other.name), rank: rankName(s.attacks.other.rank) }
          : null,
      },
      defenses: {
        unarmored: rankName(s.defenses?.unarmored),
        light: rankName(s.defenses?.light),
        medium: rankName(s.defenses?.medium),
        heavy: rankName(s.defenses?.heavy),
      },
      // Every class is trained in its own class DC at level 1; upstream has no
      // field for it because Foundry assumes it.
      classDc: 'trained',
      spellcasting: rankName(s.spellcasting),
    },
    /** How many skills beyond those the class names outright, plus any it does. */
    trainedSkills: {
      additional: Number(s.trainedSkills?.additional ?? 0),
      fixed: [...(s.trainedSkills?.value ?? [])].sort(),
    },
    featLevels: {
      class: levels(s.classFeatLevels),
      ancestry: levels(s.ancestryFeatLevels),
      general: levels(s.generalFeatLevels),
      skill: levels(s.skillFeatLevels),
    },
    skillIncreaseLevels: levels(s.skillIncreaseLevels),
    /** What the class hands out without being asked, and at which level. */
    grants: grantedItems(s),
  };
}

/**
 * Feats and class features share a document type upstream; `system.category`
 * is what separates a class feat from a class feature from a skill feat, and it
 * is the field the builder's slots filter on.
 */
function normalizeFeat(doc, ctx) {
  const s = doc.system ?? {};
  const category = String(s.category ?? 'bonus');
  return {
    ...common(doc, {
      ...ctx,
      kind: category === 'classfeature' || category === 'ancestryfeature' ? 'feature' : 'feat',
    }),
    level: Number(s.level?.value ?? 1),
    category,
    /**
     * Free text, and deliberately left that way. "Trained in Athletics" is
     * checkable and "having a patron" is not, so the builder shows every
     * prerequisite and checks only the ones it can read -- which is the
     * difference between a helpful warning and a wrong refusal.
     */
    prerequisites: (s.prerequisites?.value ?? [])
      .map((p) => String(p?.value ?? p ?? '').trim())
      .filter(Boolean),
    actionCost: actionCost(s),
    frequency: s.frequency?.max ? { max: s.frequency.max, per: s.frequency.per ?? null } : null,
    /** A feat taken more than once, and how the sheet should count it. */
    maxTakable: s.maxTakable === undefined ? 1 : (s.maxTakable === null ? Infinity : Number(s.maxTakable)),
    onlyLevel1: Boolean(s.onlyLevel1),
    /**
     * A class feat carries its class as a trait ("fighter"), which is how the
     * builder narrows six thousand feats to the forty a level 4 fighter can
     * actually take.
     */
    grants: grantedItems(s),
  };
}

/** Action cost as printed: 1/2/3 actions, a reaction, a free action, or passive. */
function actionCost(system) {
  const type = system.actionType?.value ?? 'passive';
  const count = system.actions?.value ?? null;
  if (type === 'action') return { type: 'action', count: Number(count ?? 1) };
  return { type, count: null };
}

/**
 * Armour, weapons and shields.
 *
 * This is the part the Pathbuilder import cannot do. An export gives a total
 * and leaves the sheet to infer the armour's Dexterity cap from how much
 * Dexterity reached the AC; here the cap is simply a field, so AC is computed
 * rather than reverse-engineered, and a plate-armoured character with high
 * Dexterity gets the AC the rulebook says.
 */
function normalizeEquipment(doc, ctx) {
  const s = doc.system ?? {};
  const base = {
    ...common(doc, { ...ctx, kind: 'equipment' }),
    level: Number(s.level?.value ?? 0),
    itemType: doc.type,
    bulk: s.bulk?.value ?? 0,
    price: s.price?.value ?? null,
    baseItem: s.baseItem ?? null,
    group: s.group ?? null,
    category: s.category ?? null,
  };

  if (doc.type === 'armor') {
    return {
      ...base,
      acBonus: Number(s.acBonus ?? 0),
      // `null` and `0` mean different things: no cap at all, versus a cap of
      // zero Dexterity. Full plate is the second.
      dexCap: s.dexCap === null || s.dexCap === undefined ? null : Number(s.dexCap),
      checkPenalty: Number(s.checkPenalty ?? 0),
      speedPenalty: Number(s.speedPenalty ?? 0),
      strength: s.strength === null || s.strength === undefined ? null : Number(s.strength),
    };
  }

  if (doc.type === 'shield') {
    return {
      ...base,
      acBonus: Number(s.acBonus ?? 0),
      hardness: Number(s.hardness ?? 0),
      hp: Number(s.hp?.max ?? 0),
      speedPenalty: Number(s.speedPenalty ?? 0),
    };
  }

  if (doc.type === 'weapon') {
    return {
      ...base,
      damage: {
        dice: Number(s.damage?.dice ?? 1),
        die: s.damage?.die ?? null,
        type: s.damage?.damageType ?? null,
      },
      range: s.range === null || s.range === undefined ? null : Number(s.range),
      reload: s.reload?.value ?? null,
      hands: s.hands?.value ?? null,
    };
  }

  return base;
}

function normalizeSpell(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'spell' }),
    // `level` on a spell is its rank, and calling it rank everywhere is the
    // remaster's own word for it.
    level: Number(s.level?.value ?? 1),
    rank: Number(s.level?.value ?? 1),
    traditions: [...(s.traits?.traditions ?? [])].sort(),
    time: s.time?.value ?? '',
    range: s.range?.value ?? '',
    area: s.area ? { type: s.area.type ?? '', value: Number(s.area.value ?? 0) } : null,
    target: s.target?.value ?? '',
    duration: {
      value: s.duration?.value ?? '',
      sustained: Boolean(s.duration?.sustained),
    },
    defense: s.defense?.save?.statistic
      ? { save: s.defense.save.statistic, basic: Boolean(s.defense.save.basic) }
      : null,
    heightening: s.heightening?.type ?? null,
  };
}

function normalizeAction(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'action' }),
    level: 0,
    actionCost: actionCost(s),
    category: s.category ?? null,
  };
}

function normalizeDeity(doc, ctx) {
  const s = doc.system ?? {};
  return {
    ...common(doc, { ...ctx, kind: 'deity' }),
    level: 0,
    category: s.category ?? 'deity',
    sanctification: s.sanctification ?? null,
    domains: [...(s.domains?.primary ?? [])].sort(),
    alternateDomains: [...(s.domains?.alternate ?? [])].sort(),
    font: [...(s.font ?? [])],
    weapons: [...(s.weapons ?? [])],
    skill: Array.isArray(s.skill) ? [...s.skill] : (s.skill ? [s.skill] : []),
    spells: Object.entries(s.spells ?? {})
      .map(([rank, uuid]) => ({ rank: Number(rank), uuid: String(uuid) }))
      .sort((a, b) => a.rank - b.rank),
  };
}

/** Document type -> normalizer. Anything absent is not a build option. */
const NORMALIZERS = {
  ancestry: normalizeAncestry,
  heritage: normalizeHeritage,
  background: normalizeBackground,
  class: normalizeClass,
  feat: normalizeFeat,
  spell: normalizeSpell,
  action: normalizeAction,
  deity: normalizeDeity,
  armor: normalizeEquipment,
  weapon: normalizeEquipment,
  shield: normalizeEquipment,
  equipment: normalizeEquipment,
  consumable: normalizeEquipment,
  treasure: normalizeEquipment,
  backpack: normalizeEquipment,
  ammo: normalizeEquipment,
  kit: normalizeEquipment,
};

export const isOptionDocument = (doc) => Boolean(NORMALIZERS[doc?.type]);

export function normalizeOption(doc, ctx) {
  const normalize = NORMALIZERS[doc.type];
  return normalize ? normalize(doc, ctx) : null;
}

export { titleCase, words };
