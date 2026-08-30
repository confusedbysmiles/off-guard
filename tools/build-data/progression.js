/**
 * Class proficiency advancement.
 *
 * This is the one thing a character builder needs that the upstream packs do
 * not contain. A class document states its ranks at level 1 and nothing after;
 * Foundry advances them from hardcoded class logic, not from pack data. What
 * the packs *do* state, exactly and per class, is which features are granted at
 * which level -- fighter gets "Weapon Legend" at 13, cleric gets "Third
 * Doctrine" at 7.
 *
 * So the levels come from the data and only the *effects* are written by hand.
 * That split is deliberate: a hand-maintained table of 29 classes would have
 * two ways to be wrong, and "the level is wrong" is the one that is invisible
 * at the table until someone rolls. Here it cannot happen -- the worst case is
 * a feature this file does not recognize, which is reported rather than
 * ignored, and shows up as a proficiency that never improves rather than one
 * that improves at the wrong time.
 *
 * Source: Pathfinder Player Core and Player Core 2, per-class advancement
 * tables. Every entry names the printed effect it stands for.
 */

/** `Perception Expertise` -> `{ perception: 'expert' }`, and the rest of the regulars. */
const RANK_WORDS = { expertise: 'expert', mastery: 'master', legend: 'legendary' };

const SAVES = ['fortitude', 'reflex', 'will'];
const ALL_DEFENSES = ['unarmored', 'light', 'medium', 'heavy'];
const ALL_ATTACKS = ['unarmed', 'simple', 'martial'];

/**
 * The regular names. Most classes label their advancement the same way, and
 * matching those by pattern rather than by 400 table rows is what keeps this
 * file readable.
 */
const PATTERNS = [
  // "Perception Expertise", "Perception Mastery", "Perception Legend"
  [/^Perception (Expertise|Mastery|Legend)$/i, (m) => ({ perception: RANK_WORDS[m[1].toLowerCase()] })],

  // "Fortitude Expertise", "Reflex Mastery", "Will Legend"
  [/^(Fortitude|Reflex|Will) (Expertise|Mastery|Legend)$/i,
    (m) => ({ saves: { [m[1].toLowerCase()]: RANK_WORDS[m[2].toLowerCase()] } })],

  // "Light Armor Expertise", "Medium Armor Mastery", "Heavy Armor Expertise"
  [/^(Light|Medium|Heavy) Armor (Expertise|Mastery|Legend)$/i,
    (m) => ({ defenses: defensesUpTo(m[1].toLowerCase(), RANK_WORDS[m[2].toLowerCase()]) })],

  // "Simple Weapon Expertise", "Martial Weapon Mastery"
  [/^(Simple|Martial|Advanced) Weapon (Expertise|Mastery|Legend)$/i,
    (m) => ({ attacks: { [m[1].toLowerCase()]: RANK_WORDS[m[2].toLowerCase()] } })],

  /**
   * Bare "Weapon Expertise" / "Weapon Mastery" / "Weapon Legend": the class's
   * own weapon proficiencies, all of them. Must precede the generic
   * `<Word> Expertise` class-DC pattern below, which would otherwise claim it
   * and quietly leave every fighter's attack rolls two points short.
   */
  [/^Weapon (Expertise|Mastery|Legend)$/i,
    (m) => ({ attacksTrained: RANK_WORDS[m[1].toLowerCase()] })],

  // "Expert Spellcaster", "Master Spellcaster", "Legendary Spellcaster"
  [/^(Expert|Master|Legendary) Spellcaster$/i,
    (m) => ({ spellcasting: m[1].toLowerCase() === 'legendary' ? 'legendary' : m[1].toLowerCase() })],

  // "Weapon Specialization" / "Greater Weapon Specialization" -- damage, not a rank.
  [/^Weapon Specialization$/i, () => ({ weaponSpecialization: 'standard' })],
  [/^Greater Weapon Specialization/i, () => ({ weaponSpecialization: 'greater' })],

  /**
   * Unqualified "Armor Expertise" and "Armor Mastery" raise every armour
   * category the class is already trained in. Which those are depends on the
   * class, so the effect names the intent and the applier resolves it against
   * the class's own level-1 defences.
   */
  [/^Armor (Expertise|Mastery|Legend)$/i,
    (m) => ({ defensesTrained: RANK_WORDS[m[1].toLowerCase()] })],

  /**
   * "Fighter Weapon Mastery", "Rogue Weapon Mastery" and friends: the class's
   * own weapon groups, which at this point means everything it is trained in.
   */
  [/^\w+ Weapon (Expertise|Mastery|Legend)$/i,
    (m) => ({ attacksTrained: RANK_WORDS[m[1].toLowerCase()] })],

  /**
   * "Fighter Expertise", "Wizard Expertise", "Bard Expertise": the class DC and,
   * for casters, the spellcasting proficiency. Matched last so the more specific
   * patterns above win.
   */
  [/^\w+ (Expertise|Mastery|Legend)$/i,
    (m) => ({ classDc: RANK_WORDS[m[1].toLowerCase()] })],
];

/** Armour proficiency is cumulative downward: heavy expert implies light expert. */
function defensesUpTo(category, rank) {
  const order = ['unarmored', 'light', 'medium', 'heavy'];
  const index = order.indexOf(category);
  return Object.fromEntries(order.slice(0, index + 1).map((c) => [c, rank]));
}

/**
 * The irregulars.
 *
 * Every class that gives its advancement a flavoured name needs one line here,
 * and each cites what the rulebook says it does. This is the part that has to
 * be maintained by hand; `build-report.json` lists what is still missing.
 */
const NAMED = {
  // --- Barbarian -----------------------------------------------------------
  'Juggernaut': { saves: { fortitude: 'master' } },
  'Greater Juggernaut': { saves: { fortitude: 'legendary' } },
  'Indomitable Will': { saves: { will: 'master' } },
  'Brutality': { attacksTrained: 'expert' },
  'Devastator': { attacksTrained: 'master' },
  'Mighty Rage': {},
  'Raging Resistance': {},
  'Furious Footfalls': {},
  'Revitalizing Rage': {},

  // --- Fighter -------------------------------------------------------------
  'Bravery': { saves: { will: 'expert' } },
  'Battlefield Surveyor': { perception: 'master' },
  'Battle Hardened': { saves: { fortitude: 'master' } },
  'Tempered Reflexes': { saves: { reflex: 'master' } },
  'Versatile Legend': { classDc: 'master', attacksTrained: 'legendary' },
  'Combat Flexibility': {},
  'Improved Flexibility': {},

  // --- Rogue ---------------------------------------------------------------
  'Evasion': { saves: { reflex: 'master' } },
  'Improved Evasion': { saves: { reflex: 'legendary' } },
  'Greater Weapon Specialization (Level 15)': { weaponSpecialization: 'greater' },
  'Vigilant Senses': { perception: 'master' },
  'Slippery Mind': { saves: { will: 'master' } },
  'Light Armor Mastery': { defenses: defensesUpTo('light', 'master') },
  'Master Tricks': { attacksTrained: 'master' },
  'Debilitating Strike': {},

  // --- Casters -------------------------------------------------------------
  'Magical Fortitude': { saves: { fortitude: 'expert' } },
  'Defensive Robes': { defenses: { unarmored: 'expert' } },
  'Alertness': { perception: 'expert' },
  'Resolve': { saves: { will: 'master' } },
  'Greater Resolve': { saves: { will: 'legendary' } },
  'Signature Spells': {},
  'Spell Repertoire': {},

  // --- Cleric --------------------------------------------------------------
  'Resolute Faith': { saves: { will: 'master' } },
  'Divine Defense': { defenses: { unarmored: 'expert' } },
  'Miraculous Spell': {},

  // --- Champion ------------------------------------------------------------
  'Divine Will': { saves: { will: 'master' } },
  'Sacred Body': { saves: { fortitude: 'master' } },
  'Legendary Armor': { defensesTrained: 'legendary' },
  'Exalted Reaction': {},
  'Relentless Reaction': {},
  "Hero's Defiance": {},
  'Blessing of the Devoted': {},

  // --- Bard ----------------------------------------------------------------
  "Performer's Heart": { saves: { will: 'master' } },
  "Greater Performer's Heart": { saves: { will: 'legendary' } },
  'Magnum Opus': {},

  // --- Monk ----------------------------------------------------------------
  'Graceful Legend': { defenses: { unarmored: 'legendary' }, classDc: 'master' },
  'Mystic Strikes': {},
  'Metal Strikes': {},
  'Adamantine Strikes': {},
  'Path to Perfection': {},
  'Second Path to Perfection': {},
  'Third Path to Perfection': {},
  'Graceful Mastery': { defenses: { unarmored: 'master' } },
  'Expert Strikes': { attacksTrained: 'expert' },
  'Master Strikes': { attacksTrained: 'master' },

  // --- Ranger --------------------------------------------------------------
  "Nature's Edge": {},
  'Trackless Journey': {},
  'Swift Prey': {},
  'Incredible Senses': { perception: 'legendary' },
  'Masterful Hunter': { attacksTrained: 'master', perception: 'master' },
  'Second Skin': { defensesTrained: 'master' },
  'Wild Stride': {},
  'Improved Evasion (Ranger)': { saves: { reflex: 'legendary' } },

  // --- Alchemist -----------------------------------------------------------
  'Powerful Alchemy': {},
  'Field Discovery': {},
  'Double Brew': {},
  'Advanced Vials': {},
  'Abundant Vials': {},
  'Chemical Hardiness': { saves: { fortitude: 'master' } },
  'Explosion Dodger': { saves: { reflex: 'master' } },
  'Alchemical Expertise': { classDc: 'expert' },
  'Alchemical Mastery': { classDc: 'master' },

  // --- Investigator / Swashbuckler ----------------------------------------
  'Keen Recollection': {},
  'Skillful Lessons': {},
  'Incredible Recollection': {},
  'Deductive Improvisation': {},
  'Exemplary Finisher': {},
  'Continuous Flair': {},
  'Confident Finisher': {},

  // --- Cleric doctrines: subclass-dependent, so recorded as unresolved -----
  'Second Doctrine': { deferred: 'doctrine' },
  'Third Doctrine': { deferred: 'doctrine' },
  'Fourth Doctrine': { deferred: 'doctrine' },
  'Fifth Doctrine': { deferred: 'doctrine' },
  'Final Doctrine': { deferred: 'doctrine' },
};

/**
 * What a granted feature does to a character's proficiencies, or null when this
 * file does not know. Null is the interesting answer: it is what the build
 * report counts, and what tells a maintainer which line to add.
 */
export function effectOf(featureName) {
  const name = String(featureName ?? '').trim();
  if (!name) return null;
  if (Object.hasOwn(NAMED, name)) return NAMED[name];
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(name);
    if (match) return build(match);
  }
  return null;
}

/** Levels at which a proficiency could plausibly change, for the report's triage. */
const BUMP_LEVELS = new Set([3, 5, 7, 9, 11, 13, 15, 17, 19]);

/**
 * Fold a class's granted features into a level-indexed advancement table.
 *
 * The result is `{ [level]: { perception, saves, attacks, defenses, classDc,
 * spellcasting, weaponSpecialization } }` holding only what changes at that
 * level, so the derive engine can walk levels 1..20 and carry ranks forward.
 */
export function progressionFor(classRecord) {
  const initial = classRecord.initial ?? {};
  const trainedDefenses = ALL_DEFENSES.filter((d) => (initial.defenses?.[d] ?? 'untrained') !== 'untrained');
  const trainedAttacks = ALL_ATTACKS.filter((a) => (initial.attacks?.[a] ?? 'untrained') !== 'untrained');

  const byLevel = {};
  const unmapped = [];
  const deferred = [];

  for (const grant of classRecord.grants ?? []) {
    const effect = effectOf(grant.name);
    if (effect === null) {
      // Only worth reporting where a proficiency plausibly changes. A level 1
      // class feature named "Rage" is not a gap.
      if (BUMP_LEVELS.has(grant.level)) {
        unmapped.push({ class: classRecord.id, level: grant.level, feature: grant.name });
      }
      continue;
    }
    if (effect.deferred) {
      deferred.push({ class: classRecord.id, level: grant.level, feature: grant.name, reason: effect.deferred });
      continue;
    }

    const at = (byLevel[grant.level] ??= {});
    if (effect.perception) at.perception = effect.perception;
    if (effect.classDc) at.classDc = effect.classDc;
    if (effect.spellcasting) at.spellcasting = effect.spellcasting;
    if (effect.weaponSpecialization) at.weaponSpecialization = effect.weaponSpecialization;
    if (effect.saves) at.saves = { ...(at.saves ?? {}), ...effect.saves };
    if (effect.defenses) at.defenses = { ...(at.defenses ?? {}), ...effect.defenses };
    if (effect.attacks) at.attacks = { ...(at.attacks ?? {}), ...effect.attacks };

    // "the ones you already have": resolved here, against this class's own
    // level-1 ranks, because the phrase means something different per class.
    if (effect.defensesTrained) {
      at.defenses = {
        ...(at.defenses ?? {}),
        ...Object.fromEntries(trainedDefenses.map((d) => [d, effect.defensesTrained])),
      };
    }
    if (effect.attacksTrained) {
      at.attacks = {
        ...(at.attacks ?? {}),
        ...Object.fromEntries(trainedAttacks.map((a) => [a, effect.attacksTrained])),
      };
    }
  }

  return { byLevel, unmapped, deferred };
}

export { SAVES, ALL_DEFENSES, ALL_ATTACKS };
