/**
 * Static knowledge about the upstream packs: what a compendium name maps to on
 * disk, what kind of thing a pack holds, and how to classify a source.
 *
 * The alias list below is derived from the corpus, not guessed: every compendium
 * name that actually appears inside an `@UUID[Compendium.pf2e.<name>....]`
 * reference across all 29,598 pack files is accounted for here.
 */

/** Compendium name used in UUIDs -> directory under packs/pf2e. */
export const COMPENDIUM_ALIASES = {
  conditionitems: 'conditions',
  'spells-srd': 'spells',
  actionspf2e: 'actions',
  'feats-srd': 'feats',
  'equipment-srd': 'equipment',
  classfeatures: 'class-features',
  ancestryfeatures: 'ancestry-features',
};

/** Directory -> the link kind we expose in `#/ref/<kind>/<id>` routes. */
export const PACK_REF_KINDS = {
  conditions: 'condition',
  actions: 'action',
  'action-macros': 'action',
  'adventure-specific-actions': 'action',
  spells: 'spell',
  equipment: 'equipment',
  feats: 'feat',
  hazards: 'hazard',
  deities: 'deity',
  heritages: 'heritage',
  backgrounds: 'background',
  'class-features': 'class-feature',
  'ancestry-features': 'ancestry-feature',
  'familiar-abilities': 'familiar-ability',
  'kingmaker-features': 'feature',
  'bestiary-ability-glossary-srd': 'creature-ability',
  'bestiary-family-ability-glossary': 'creature-ability',
  vehicles: 'vehicle',
  journals: 'journal',
  'rollable-tables': 'table',
  criticaldeck: 'table',
  'boons-and-curses': 'effect',
  'pathfinder-society-boons': 'effect',
};

/** Effect packs all resolve to the same kind; they exist for Foundry automation. */
const EFFECT_PACKS = [
  'spell-effects', 'feat-effects', 'equipment-effects', 'bestiary-effects',
  'campaign-effects', 'other-effects', 'bestiary-family-ability-glossary',
];
for (const p of EFFECT_PACKS) PACK_REF_KINDS[p] ??= 'effect';

/** Packs whose actors we normalize into the creature/hazard catalogue. */
export const isCreaturePack = (pack) =>
  pack.endsWith('-bestiary') ||
  pack.startsWith('pathfinder-bestiary') ||
  pack.startsWith('pathfinder-monster-core') ||
  pack === 'pathfinder-npc-core' ||
  pack === 'npc-gallery' ||
  pack === 'hazards' ||
  pack === 'fall-of-plaguestone' ||
  pack === 'standalone-adventures' ||
  pack === 'pathfinder-dark-archive' ||
  pack === 'book-of-the-dead-bestiary' ||
  pack === 'rage-of-elements-bestiary' ||
  pack === 'lost-omens-bestiary' ||
  pack === 'kingmaker-bestiary' ||
  pack === 'blog-bestiary';

/**
 * Source tier, used for the source filter in creature search. The default search
 * filter is `remaster === true`, per the licence split in the data itself; tier
 * is the second axis so "Monster Core only" is one click.
 */
export function packTier(pack) {
  if (pack.startsWith('pfs-')) return 'organized-play';
  if (pack.startsWith('pathfinder-monster-core') || pack === 'pathfinder-npc-core') return 'core';
  if (pack.startsWith('pathfinder-bestiary')) return 'core';
  if (pack === 'hazards') return 'core';
  if (pack.endsWith('-bestiary') || pack === 'fall-of-plaguestone' || pack === 'standalone-adventures') {
    return 'adventure';
  }
  return 'supplement';
}

/**
 * PF2e creature types. There is no `creatureType` field on NPC actors: the type
 * is whichever of these traits appears in `system.traits.value`. Some creatures
 * carry two (a construct dragon), some carry none.
 * Source: Monster Core, "Creature Types".
 */
export const CREATURE_TYPE_TRAITS = [
  'aberration', 'animal', 'astral', 'beast', 'celestial', 'construct', 'dragon',
  'dream', 'elemental', 'ethereal', 'fey', 'fiend', 'fungus', 'giant', 'humanoid',
  'monitor', 'ooze', 'plant', 'shade', 'spirit', 'time', 'undead',
];

export const SIZE_NAMES = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan',
};

/** Resolve a compendium name from a UUID to its on-disk pack directory. */
export const packDirFor = (compendiumName) =>
  COMPENDIUM_ALIASES[compendiumName] ?? compendiumName;
