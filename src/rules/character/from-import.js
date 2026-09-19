/**
 * A build document, reconstructed from a Pathbuilder export.
 *
 * The import used to write the sheet and leave the builder empty, which made
 * an imported character and a built one two different kinds of thing that the
 * application quietly disagreed about. This closes that: what comes out of
 * here is an ordinary build, and the character it describes can be levelled up
 * in the builder like any other.
 *
 * Pathbuilder exports results, not choices. It says Strength 18, not "ancestry
 * boost, background boost, two level boosts"; it says Stealth +11, not "trained
 * at level 1 and increased at 3". So this file works backwards, and the answers
 * it finds are *an* account of how the character got here rather than *the*
 * one. That is fine -- two accounts that produce the same numbers are the same
 * character -- but only if the numbers really do come out the same, which is
 * why nothing here is trusted: `checkAgainst` derives the reconstruction and
 * compares it to the sheet that was imported, field by field, and anything
 * that does not match is reported rather than applied quietly.
 *
 * The catalogue arrives as `find(kind, name)`, injected, so this stays
 * arithmetic over data it was given and the tests need no data build.
 */
import {
  ATTRIBUTES, BOOST_LEVELS, BOOSTS_PER_LEVEL, boosted,
} from './attributes.js';
import { SKILLS } from './derive.js';

const RANK_ORDER = ['untrained', 'trained', 'expert', 'master', 'legendary'];
const RANK_BY_BONUS = { 0: 'untrained', 2: 'trained', 4: 'expert', 6: 'master', 8: 'legendary' };
const rankOf = (bonus) => RANK_BY_BONUS[Number(bonus)] ?? 'untrained';
const stepsAbove = (rank) => Math.max(0, RANK_ORDER.indexOf(rank) - 1);

/** What level a rank cannot be reached before. The same table `skillRanks` enforces. */
const MINIMUM_LEVEL = { expert: 3, master: 7, legendary: 15 };

const whole = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * The attribute that gains most from a boost here.
 *
 * Among those this slot allows, not already boosted in this section -- one
 * boost per attribute per section is the rule -- and still short of where it
 * needs to be. When nothing is short the slot is left empty rather than spent
 * on something that would overshoot: an unfilled slot shows in the builder as
 * a choice still to make, which is true, and keeps the numbers right.
 */
function pickBoost(allowed, taken, shortfall) {
  const candidates = (allowed ?? ATTRIBUTES)
    .filter((a) => ATTRIBUTES.includes(a) && !taken.includes(a) && shortfall(a) > 0);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => shortfall(b) - shortfall(a) || ATTRIBUTES.indexOf(a) - ATTRIBUTES.indexOf(b))[0];
}

/**
 * Which boosts would produce these modifiers.
 *
 * Walked in the same order `attributeModifiers` walks -- ancestry, background,
 * class, then each boost level -- because the partial boost above +4 makes the
 * order matter, and a simulation that ran in a different order would agree
 * about the total and disagree about the answer.
 */
export function solveBoosts(target, { ancestry, background, klass, keyAttribute, level }) {
  const exact = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0]));
  const picks = {
    ancestry: [], background: [], class: keyAttribute ?? null, 1: [], 5: [], 10: [], 15: [], 20: [],
  };
  const apply = (a) => { exact[a] = boosted(exact[a]); };

  /**
   * The class's key attribute is not a choice, and it has not happened yet.
   *
   * It lands after the ancestry and the background, so during those sections
   * the attribute it will boost already has one more boost coming than its
   * current value admits. Without reserving it, a character whose Strength
   * should end at +1 gets a Strength boost from their ancestry as well and
   * ends at +2 -- the free choices spending what the class was going to give.
   */
  let reserved = ATTRIBUTES.includes(keyAttribute) ? keyAttribute : null;
  const shortfall = (a) => Number(target[a] ?? 0) - exact[a] - (a === reserved ? 1 : 0);

  // --- the ancestry, whose flaws land after its boosts
  const flaws = (ancestry?.flaws ?? []).filter((a) => ATTRIBUTES.includes(a));
  const fixed = (ancestry?.boosts ?? []).filter((b) => !b.free)
    .map((b) => b.options?.[0]).filter((a) => ATTRIBUTES.includes(a));
  for (const a of fixed) apply(a);

  // The flaw has not been taken yet but is coming, so a flawed attribute needs
  // one more boost than it currently looks as though it does.
  const ancestryShortfall = (a) => shortfall(a) + (flaws.includes(a) ? 1 : 0);
  for (const slot of (ancestry?.boosts ?? []).filter((b) => b.free)) {
    const pick = pickBoost(slot.options, [...fixed, ...picks.ancestry], ancestryShortfall);
    if (!pick) continue;
    picks.ancestry.push(pick);
    apply(pick);
  }
  for (const a of flaws) exact[a] -= 1;

  // --- the background: one boost from a short list, and one free
  for (const slot of background?.boosts ?? []) {
    const pick = pickBoost(slot.options, picks.background, shortfall);
    if (!pick) continue;
    picks.background.push(pick);
    apply(pick);
  }

  // --- the class's key attribute, which is not a free choice
  reserved = null;
  if (picks.class && ATTRIBUTES.includes(picks.class)) apply(picks.class);
  else picks.class = null;

  // --- four at each boost level the character has reached
  for (const boostLevel of BOOST_LEVELS) {
    if (boostLevel > level) break;
    for (let slot = 0; slot < BOOSTS_PER_LEVEL; slot += 1) {
      const pick = pickBoost(ATTRIBUTES, picks[boostLevel], shortfall);
      if (!pick) break;
      picks[boostLevel].push(pick);
      apply(pick);
    }
  }

  return picks;
}

/**
 * Which skills were trained, and which increases raised them.
 *
 * A rank is the sum of a training and some increases, and the export gives
 * only the sum. The training is whatever the background and class did not
 * already grant; the increases are spread over the levels the class offers
 * them at, lowest first, because a rank has a minimum level and the early
 * levels are the constrained ones.
 */
export function solveSkills(proficiencies = {}, { background, klass, level }) {
  const ranks = Object.fromEntries(
    SKILLS.map((skill) => [skill, rankOf(proficiencies[skill])]),
  );
  const granted = new Set([
    ...(background?.trainedSkills ?? []),
    ...(klass?.trainedSkills?.fixed ?? []),
  ]);

  const trained = SKILLS.filter((skill) => ranks[skill] !== 'untrained');
  const chosen = trained.filter((skill) => !granted.has(skill));

  /**
   * One entry per increase still owed, each knowing the rank it produces.
   *
   * The rank matters because a rank has a minimum level -- expert at 3, master
   * at 7, legendary at 15 -- and a class can offer a skill increase before
   * then. An increase placed at a level too early is refused by `skillRanks`
   * and the skill silently stays a rank low, which is exactly the class of
   * quiet wrongness this whole file exists to avoid. So the levels are walked
   * in order and each one takes the first increase that is legal there and
   * whose earlier steps are already placed.
   */
  const owed = [];
  for (const skill of trained) {
    for (let step = 0; step < stepsAbove(ranks[skill]); step += 1) {
      owed.push({ skill, rank: RANK_ORDER[step + 2], step });
    }
  }

  const levels = (klass?.skillIncreaseLevels ?? []).filter((l) => l <= level)
    .sort((a, b) => a - b);
  const increases = {};
  const placed = new Set();
  const stepsDone = new Map();

  for (const increaseLevel of levels) {
    const next = owed.find((entry, index) => !placed.has(index)
      && (MINIMUM_LEVEL[entry.rank] ?? 1) <= increaseLevel
      && (stepsDone.get(entry.skill) ?? 0) === entry.step);
    if (!next) continue;
    increases[increaseLevel] = next.skill;
    placed.add(owed.indexOf(next));
    stepsDone.set(next.skill, next.step + 1);
  }

  return { trained: chosen, increases, unplaced: owed.length - placed.size };
}

/** Pathbuilder writes a Lore as `["Warfare", 2]`. */
const loresFrom = (lores, background) => (lores ?? [])
  .map((entry) => (Array.isArray(entry) ? { name: entry[0], rank: rankOf(entry[1]) } : null))
  .filter((lore) => lore?.name)
  .map((lore) => ({ name: String(lore.name).endsWith('Lore') ? lore.name : `${lore.name} Lore`, rank: lore.rank }))
  // The background's own Lore is granted by the background, not written down
  // here, or the character would have it twice.
  .filter((lore) => !(background?.trainedLore ?? []).includes(lore.name));

/**
 * The armour actually worn, as an item the build can carry.
 *
 * Matched to the catalogue by name where it can be -- then it has a real Bulk
 * and a real price -- and otherwise described from the numbers the import
 * already worked out. That second path is the common one: the worn armour in a
 * real export is called "Arachnid Harness", which is a magic item and not a
 * base one, and describing it from the AC the file states reproduces the AC
 * the file states, which is the whole requirement.
 */
function armorFrom(pb, sheet, find) {
  const worn = (pb.armor ?? []).find((piece) => piece?.worn && piece?.prof !== 'shield');
  if (!worn?.name) return null;

  const potency = whole(worn.pot, 0, 4, 0);
  const catalogue = find('equipment', worn.name);
  if (catalogue?.itemType === 'armor') return { id: catalogue.id, potency };

  return {
    custom: {
      name: String(worn.name),
      category: worn.prof ?? 'light',
      // The import's own arithmetic, so the sheet keeps the number it had.
      acBonus: Math.max(0, Number(sheet?.ac?.itemBonus ?? 0) - potency),
      dexCap: sheet?.ac?.dexCap ?? null,
    },
    potency,
  };
}

/**
 * The weapons, with the attack total preserved exactly.
 *
 * Pathbuilder gives one number where the engine wants five, and the parts it
 * does give -- the potency rune, the striking rune -- do not add up to it on
 * their own. So whatever is left over after the attribute, the proficiency and
 * the runes goes into `other`, which is the field that exists for exactly this:
 * a bonus the sheet cannot explain but the player can see. The strike then
 * comes out at the number the file said.
 */
function weaponsFrom(pb, sheet) {
  const byName = new Map((sheet?.strikes ?? []).map((strike) => [strike.name, strike]));
  return (pb.weapons ?? []).filter((w) => w?.name).map((w) => {
    const strike = byName.get(w.display) ?? byName.get(w.name) ?? null;
    const potency = whole(w.pot, 0, 4, 0);
    return {
      custom: {
        name: String(w.display || w.name),
        category: w.prof ?? 'simple',
        die: w.die ?? 'd6',
        damageType: DAMAGE_LETTER[w.damageType] ?? 'bludgeoning',
        traits: Array.isArray(w.traits) ? w.traits : [],
      },
      potency,
      striking: String(w.str ?? '').includes('striking') ? 1 : 0,
      damageBonus: whole(w.damageBonus, -20, 20, 0),
      // Filled in by `reconcileStrikes`, which needs the derived sheet to know
      // what the engine would have said without it.
      other: 0,
      attack: Number(strike?.attack ?? w.attack ?? 0),
    };
  });
}

const DAMAGE_LETTER = {
  S: 'slashing', P: 'piercing', B: 'bludgeoning',
  slashing: 'slashing', piercing: 'piercing', bludgeoning: 'bludgeoning',
};

/**
 * The whole build.
 *
 * @param {object} exported  a Pathbuilder export, wrapped or not
 * @param {object} options
 * @param {function} options.find    `(kind, name) => record | null`
 * @param {object}   options.sheet   what `mapPathbuilder` made of the same file
 */
export function buildFromImport(exported, { find = () => null, sheet = {} } = {}) {
  const pb = exported?.build ?? exported;
  const notes = [];
  if (!pb || typeof pb !== 'object') {
    return { build: null, notes: ['That file does not look like a Pathbuilder export.'] };
  }

  const look = (kind, name) => {
    if (!name) return null;
    const found = find(kind, String(name));
    if (!found) {
      notes.push(`No ${kind} called “${name}” is in the catalogue, so that choice is left for you to make.`);
    }
    return found;
  };

  const ancestry = look('ancestry', pb.ancestry);
  const heritage = look('heritage', pb.heritage);
  const background = look('background', pb.background);
  const klass = look('class', pb.class);
  const level = whole(pb.level, 1, 20, 1);

  const target = Object.fromEntries(ATTRIBUTES.map((a) => [a, Number(sheet?.abilities?.[a] ?? 0)]));
  const keyAttribute = String(pb.keyability ?? '').toLowerCase();

  const boosts = solveBoosts(target, {
    ancestry, background, klass, level,
    keyAttribute: ATTRIBUTES.includes(keyAttribute) ? keyAttribute : null,
  });

  const skills = solveSkills(pb.proficiencies ?? {}, { background, klass, level });
  if (skills.unplaced) {
    notes.push(
      `${skills.unplaced} skill increase${skills.unplaced === 1 ? '' : 's'} could not be placed: `
      + 'this character has more skill training than their class grants by this level.',
    );
  }

  const money = pb.money ?? {};
  const coins = Object.fromEntries(
    ['pp', 'gp', 'sp', 'cp'].map((c) => [c, whole(money[c], 0, 1e9, 0)]),
  );

  return {
    build: {
      version: 1,
      level,
      ancestry: ancestry?.id ?? null,
      heritage: heritage?.id ?? null,
      background: background?.id ?? null,
      class: klass?.id ?? null,
      attributes: boosts,
      skills: {
        trained: skills.trained,
        increases: skills.increases,
        lores: loresFrom(pb.lores, background),
      },
      feats: {},
      equipment: {
        armor: armorFrom(pb, sheet, find),
        shield: null,
        weapons: weaponsFrom(pb, sheet),
        gear: (sheet?.gear ?? []).map((row) => ({
          custom: { name: row.name }, quantity: row.quantity ?? 1,
        })),
      },
      coins,
    },
    notes,
  };
}

/**
 * What the reconstruction got wrong, said out loud.
 *
 * The point of the whole file. A build that derives different numbers from the
 * ones in the file is not a faithful account of the character, and the player
 * is the only one who can decide whether the difference matters -- so every
 * one is listed, with both values, rather than smoothed over.
 */
export function checkAgainst(imported = {}, derived = {}) {
  const differences = [];
  const compare = (label, path, a, b) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    differences.push({ label, path, imported: a ?? null, derived: b ?? null });
  };

  for (const attribute of ATTRIBUTES) {
    compare(attribute.toUpperCase(), `abilities.${attribute}`,
      imported.abilities?.[attribute], derived.abilities?.[attribute]);
  }
  compare('Hit points', 'hp.max', imported.hp?.max, derived.hp?.max);
  compare('Armour Class rank', 'ac.rank', imported.ac?.rank, derived.ac?.rank);
  compare('Perception', 'perception.rank', imported.perception?.rank, derived.perception?.rank);
  compare('Speed', 'speed', imported.speed, derived.speed);
  for (const save of ['fortitude', 'reflex', 'will']) {
    compare(`${save[0].toUpperCase()}${save.slice(1)} save`, `saves.${save}.rank`,
      imported.saves?.[save]?.rank, derived.saves?.[save]?.rank);
  }
  for (const skill of SKILLS) {
    compare(skill, `skills.${skill}.rank`,
      imported.skills?.[skill]?.rank, derived.skills?.[skill]?.rank);
  }

  return differences;
}
