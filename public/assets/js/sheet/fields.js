/**
 * The sheet's vocabulary: what a Pathfinder character has, in the order a
 * player looks for it.
 *
 * Kept as data rather than markup so the sheet, the print view and the party
 * panel in the GM dashboard all describe a character the same way.
 */

export const ATTRIBUTES = [
  ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
];

export const SAVES = [
  ['fortitude', 'Fortitude', 'con'],
  ['reflex', 'Reflex', 'dex'],
  ['will', 'Will', 'wis'],
];

/** The sixteen skills, with the attribute each keys off. */
export const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dex'],
  ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'],
  ['crafting', 'Crafting', 'int'],
  ['deception', 'Deception', 'cha'],
  ['diplomacy', 'Diplomacy', 'cha'],
  ['intimidation', 'Intimidation', 'cha'],
  ['medicine', 'Medicine', 'wis'],
  ['nature', 'Nature', 'wis'],
  ['occultism', 'Occultism', 'int'],
  ['performance', 'Performance', 'cha'],
  ['religion', 'Religion', 'wis'],
  ['society', 'Society', 'int'],
  ['stealth', 'Stealth', 'dex'],
  ['survival', 'Survival', 'wis'],
  ['thievery', 'Thievery', 'dex'],
];

export const RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** Free-text sections. The import never touches these, by design. */
export const NOTES_SECTIONS = [
  ['feats', 'Feats'],
  ['features', 'Class features'],
  ['reactions', 'Reactions and free actions'],
  ['items', 'Items'],
  ['notes', 'Notes'],
];

/**
 * Conditions that carry a value. The rest are on or off.
 * Player Core, Conditions.
 */
export const VALUED_CONDITIONS = new Set([
  'clumsy', 'doomed', 'drained', 'dying', 'enfeebled', 'frightened',
  'sickened', 'slowed', 'stunned', 'stupefied', 'wounded',
]);

export const CONDITIONS = [
  'blinded', 'broken', 'clumsy', 'concealed', 'confused', 'controlled', 'dazzled',
  'deafened', 'doomed', 'drained', 'dying', 'encumbered', 'enfeebled', 'fascinated',
  'fatigued', 'fleeing', 'frightened', 'grabbed', 'hidden', 'immobilized', 'invisible',
  'observed', 'off-guard', 'paralyzed', 'petrified', 'prone', 'quickened', 'restrained',
  'sickened', 'slowed', 'stunned', 'stupefied', 'unconscious', 'undetected', 'wounded',
];
