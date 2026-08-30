/**
 * The rules engine.
 *
 * Dependency-free and environment-free: no Node APIs, no DOM, no imports
 * outside `src/`. The server and the browser both use this module, and nothing
 * else in the application is allowed to do arithmetic on a stat block or on a
 * character sheet.
 *
 * Everything here is a pure function over plain values. Creature transforms
 * return a new record and never mutate the one they were given, so a toggle in
 * the interface is a re-render rather than an undo.
 *
 * What is rules as written, and what is not:
 *
 *   adjust.js            RAW. Monster Core, Elite and Weak Adjustments.
 *   encounter.js         RAW. GM Core pg. 75.
 *   dc.js                RAW. GM Core pg. 53.
 *   recall-knowledge.js  RAW for skills and DC; the ordering of what a success
 *                        reveals is this application's convenience and says so.
 *   proficiency.js       RAW. Player Core, Proficiency.
 *   conditions.js        RAW where the rules state it plainly, and a prompt
 *                        everywhere else. Only frightened decreases on its own
 *                        at the end of a turn; everything ambiguous is asked.
 *   dice.js              RAW for halving and doubling; the expression syntax
 *                        is this application's, and deliberately small.
 *   scale.js             NOT RAW -- there is no printed operation for moving a
 *                        creature between levels -- but built from the printed
 *                        GM Core creature-building tables. Labelled an
 *                        approximation everywhere it surfaces.
 */
export {
  adjustCreature, isLimitedUse,
} from './adjust.js';

export {
  describeScaling, scaleCreature, SCALE_RANGE,
} from './scale.js';

export {
  budgetFor, budgets, creatureCost, DIFFICULTIES, difficultyOf,
  priceEncounter, repriceEncounter, STANDARD_PARTY_SIZE,
} from './encounter.js';

export {
  DC_ADJUSTMENT, DC_BY_LEVEL, DC_BY_RARITY, DC_BY_SPELL_RANK, DEGREES,
  dcByLevel, dcBySpellRank, degreeOfSuccess, simpleDc, SIMPLE_DC,
} from './dc.js';

export {
  factsFor, recallKnowledge, skillsFor,
} from './recall-knowledge.js';

export {
  averageOf, DiceError, DIE_FACES, double, format as formatDice, halve,
  parseDice, rollDice,
} from './dice.js';

export {
  armorClass, classDc, PROFICIENCY_BONUS, PROFICIENCY_RANKS,
  proficiencyBonus, rankName, statistic,
} from './proficiency.js';

export {
  adjustRichText, flatDamageAdjuster, projectedDamageAdjuster,
} from './rich-text.js';

export {
  addCondition, applyAutomatic, applyDamage, conditionValue, CONDITION_SLUGS,
  CONDITIONS, DYING_MAXIMUM, endOfTurn, isValued, PERSISTENT_FLAT_DC,
  recoverFromDying, removeCondition, setConditionValue, startOfTurn,
} from './conditions.js';

/**
 * The character builder's derivation.
 *
 * Exported from here so the browser reaches it the same way it reaches every
 * other piece of the engine -- `/engine/rules/index.js` -- rather than by
 * knowing where inside `src/rules/` it lives.
 */
export {
  DERIVED_PATHS, deriveCharacter, isDerivedPath, proficienciesAt,
} from './character/derive.js';

export {
  attributeModifiers, boosted, boostProblems,
} from './character/attributes.js';

export { outstanding, slotsFor } from './character/slots.js';
