/**
 * A build document, derived into a sheet.
 *
 * The fixture holds real ancestry, background, class and progression records
 * from the pinned upstream rather than hand-written ones, because the shapes
 * this engine reads are upstream's and a synthetic fixture would only prove the
 * engine agrees with itself. The expected numbers are worked through by hand
 * from Player Core.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  deriveCharacter, hitPoints, isDerivedPath, proficienciesAt, skillRanks,
} from '../../src/rules/character/derive.js';

const OPTIONS = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);

const dwarf = OPTIONS.ancestry['ancestry:dwarf'];
const acolyte = OPTIONS.background['background:acolyte'];
const fighter = OPTIONS.class['class:fighter'];
const wizard = OPTIONS.class['class:wizard'];
const fighterProgression = OPTIONS.progression['class:fighter'];
const wizardProgression = OPTIONS.progression['class:wizard'];

/** A dwarf acolyte fighter, the build every one of these tests starts from. */
const build = (over = {}) => ({
  name: 'Durgan',
  level: 1,
  // Only the free choices: the dwarf's fixed Constitution and Wisdom are the
  // ancestry's, not the player's, and the derivation composes them in.
  attributes: {
    ancestry: ['str'],
    background: ['wis', 'str'],
    class: 'str',
    1: ['str', 'dex', 'con', 'cha'],
  },
  skills: { trained: ['athletics', 'intimidation', 'survival'], increases: {}, lores: [] },
  ...over,
});

const context = {
  ancestry: dwarf, background: acolyte, klass: fighter, progression: fighterProgression,
};

describe('proficiencies over levels', () => {
  it('starts a fighter where the class document says', () => {
    const at1 = proficienciesAt(fighterProgression, 1);
    expect(at1.perception).toBe('expert');
    expect(at1.saves).toMatchObject({ fortitude: 'expert', reflex: 'expert', will: 'trained' });
    expect(at1.attacks.martial).toBe('expert');
    expect(at1.classDc).toBe('trained');
  });

  it('advances a fighter exactly as Player Core prints it', () => {
    // Bravery at 3, Fighter Weapon Mastery at 5, Battlefield Surveyor at 7,
    // Battle Hardened at 9, Armor Expertise and Fighter Expertise at 11,
    // Weapon Legend at 13.
    expect(proficienciesAt(fighterProgression, 2).saves.will).toBe('trained');
    expect(proficienciesAt(fighterProgression, 3).saves.will).toBe('expert');
    expect(proficienciesAt(fighterProgression, 4).attacks.martial).toBe('expert');
    expect(proficienciesAt(fighterProgression, 5).attacks.martial).toBe('master');
    expect(proficienciesAt(fighterProgression, 7).perception).toBe('master');
    expect(proficienciesAt(fighterProgression, 9).saves.fortitude).toBe('master');
    expect(proficienciesAt(fighterProgression, 11).classDc).toBe('expert');
    expect(proficienciesAt(fighterProgression, 11).defenses.heavy).toBe('expert');
    expect(proficienciesAt(fighterProgression, 13).attacks.martial).toBe('legendary');
  });

  it('carries a rank forward rather than resetting it', () => {
    expect(proficienciesAt(fighterProgression, 20).attacks.martial).toBe('legendary');
    expect(proficienciesAt(fighterProgression, 20).saves.will).toBe('expert');
  });

  it('never lowers a rank, whatever order features arrive in', () => {
    const scrambled = {
      initial: { perception: 'master', saves: {}, attacks: {}, defenses: {} },
      byLevel: { 5: { perception: 'expert' } },
    };
    expect(proficienciesAt(scrambled, 5).perception).toBe('master');
  });

  it('advances a wizard’s spellcasting', () => {
    expect(proficienciesAt(wizardProgression, 1).spellcasting).toBe('trained');
    expect(proficienciesAt(wizardProgression, 7).spellcasting).toBe('expert');
  });
});

describe('hit points', () => {
  it('applies Constitution every level, not once', () => {
    // Dwarf 10 + (fighter 10 + con 3) x 5 = 75
    expect(hitPoints({ ancestry: dwarf, klass: fighter, conMod: 3, level: 5 })).toBe(75);
  });

  it('is the ancestry plus one class-and-Constitution step at level 1', () => {
    expect(hitPoints({ ancestry: dwarf, klass: fighter, conMod: 3, level: 1 })).toBe(23);
  });
});

describe('skills', () => {
  it('counts the class allowance plus Intelligence, and no less than the class', () => {
    const negative = skillRanks(build(), { klass: fighter, background: acolyte, intMod: -1, level: 1 });
    expect(negative.allowance).toBe(fighter.trainedSkills.additional);
  });

  it('trains the background’s skill without being asked', () => {
    const { ranks } = skillRanks(build(), { klass: fighter, background: acolyte, intMod: 0, level: 1 });
    expect(ranks.religion).toBe('trained');
  });

  it('reports a choice that duplicates the background rather than silently eating it', () => {
    const { problems } = skillRanks(
      build({ skills: { trained: ['religion', 'athletics', 'stealth'], increases: {}, lores: [] } }),
      { klass: fighter, background: acolyte, intMod: 0, level: 1 },
    );
    expect(problems.some((p) => p.kind === 'redundant-skill' && p.skill === 'religion')).toBe(true);
  });

  it('raises a skill one rank per increase, in level order', () => {
    const withIncreases = build({
      level: 7,
      skills: {
        trained: ['athletics', 'intimidation', 'survival'],
        increases: { 3: 'athletics', 5: 'athletics', 7: 'athletics' },
        lores: [],
      },
    });
    const { ranks } = skillRanks(withIncreases, { klass: fighter, background: acolyte, intMod: 0, level: 7 });
    expect(ranks.athletics).toBe('master');
  });

  it('refuses a rank the character is too low a level for, and says so', () => {
    const early = build({
      level: 5,
      skills: {
        trained: ['athletics', 'intimidation', 'survival'],
        increases: { 3: 'athletics', 5: 'athletics' },
        lores: [],
      },
    });
    const { ranks, problems } = skillRanks(early, { klass: fighter, background: acolyte, intMod: 0, level: 5 });
    // Trained -> expert at 3 is legal; expert -> master needs level 7.
    expect(ranks.athletics).toBe('expert');
    expect(problems.some((p) => p.kind === 'too-early' && p.rank === 'master')).toBe(true);
  });

  it('ignores an increase planned above the character’s level', () => {
    const planned = build({
      skills: { trained: ['athletics', 'intimidation', 'survival'], increases: { 3: 'athletics' }, lores: [] },
    });
    const { ranks } = skillRanks(planned, { klass: fighter, background: acolyte, intMod: 0, level: 1 });
    expect(ranks.athletics).toBe('trained');
  });
});

describe('deriveCharacter', () => {
  it('produces the sheet paths the rest of the application already reads', () => {
    const { sheet } = deriveCharacter(build(), context);
    expect(sheet).toMatchObject({
      name: 'Durgan',
      level: 1,
      ancestry: 'Dwarf',
      background: 'Acolyte',
      class: 'Fighter',
      keyAttribute: 'str',
      size: 'Medium',
    });
    // str: dwarf free + background free + key attribute + level 1 = +4
    // con: dwarf's fixed boost + level 1 = +2
    // cha: the dwarf flaw, then boosted back to 0 at level 1
    expect(sheet.abilities).toEqual({ str: 4, dex: 1, con: 2, int: 0, wis: 2, cha: 0 });
    expect(sheet.perception.rank).toBe('expert');
    expect(sheet.saves.will.rank).toBe('trained');
    expect(sheet.skills.religion.rank).toBe('trained');
    expect(sheet.speed).toBe(20);
    // Dwarf 10 + (fighter 10 + con 2) = 22
    expect(sheet.hp.max).toBe(22);
  });

  it('gives armour class the class’s unarmoured proficiency', () => {
    // A fighter is trained in unarmoured defence from level 1. Leaving the rank
    // unset is what showed a level 6 fighter an AC of 12 rather than 20.
    const { sheet } = deriveCharacter(build({ level: 6 }), context);
    expect(sheet.ac.rank).toBe('trained');
    expect(sheet.ac.dexCap).toBe(null);
    expect(sheet.ac.itemBonus).toBe(0);
  });

  it('carries the ancestry’s languages and its granted lore', () => {
    const { sheet } = deriveCharacter(build(), context);
    expect(sheet.languages).toEqual(expect.arrayContaining(['common', 'dwarven']));
    expect(sheet.lores).toContainEqual({ name: 'Scribing Lore', rank: 'trained' });
  });

  it('leaves play state alone entirely', () => {
    const { sheet } = deriveCharacter(build(), context);
    expect(sheet).not.toHaveProperty('hp.current');
    expect(sheet).not.toHaveProperty('conditions');
    expect(sheet).not.toHaveProperty('heroPoints');
  });

  it('does not name an unnamed character', () => {
    const { sheet } = deriveCharacter(build({ name: '' }), context);
    expect(sheet).not.toHaveProperty('name');
  });

  it('changes nothing on the sheet when a level is only planned', () => {
    const planned = build({
      attributes: { ...build().attributes, 5: ['str', 'dex', 'con', 'wis'] },
    });
    const now = deriveCharacter(planned, context);
    const later = deriveCharacter({ ...planned, level: 5 }, context);
    expect(now.sheet.abilities.dex).toBe(1);
    expect(later.sheet.abilities.dex).toBe(2);
    expect(later.sheet.hp.max).toBeGreaterThan(now.sheet.hp.max);
  });

  it('collects what is still unchosen instead of guessing', () => {
    const incomplete = deriveCharacter(build({
      attributes: { ancestry: [], background: [], class: null, 1: [] },
      skills: { trained: [], increases: {}, lores: [] },
    }), context);
    const kinds = incomplete.problems.map((p) => p.kind);
    expect(kinds).toContain('incomplete');
    expect(incomplete.problems.some((p) => p.section === 'class')).toBe(true);
  });

  it('clamps a level outside 1-20 rather than producing nonsense', () => {
    expect(deriveCharacter(build({ level: 40 }), context).sheet.level).toBe(20);
    expect(deriveCharacter(build({ level: 0 }), context).sheet.level).toBe(1);
  });

  it('derives a wizard as readily as a fighter', () => {
    const mage = deriveCharacter(build({
      level: 7,
      attributes: { ancestry: ['int'], background: ['wis', 'int'], class: 'int', 1: ['int', 'dex', 'con', 'wis'], 5: ['int', 'dex', 'con', 'wis'] },
      skills: { trained: ['arcana', 'society'], increases: {}, lores: [] },
    }), { ...context, klass: wizard, progression: wizardProgression });
    expect(mage.sheet.class).toBe('Wizard');
    expect(mage.proficiencies.spellcasting).toBe('expert');
    expect(mage.sheet.abilities.int).toBe(4);
  });
});

/**
 * Which fields the build owns.
 *
 * This is what the sheet locks. Getting it wrong in either direction is bad in
 * a different way: too wide and a player cannot edit something the builder
 * never sets, too narrow and the builder silently reverts what they typed.
 */
describe('field ownership', () => {
  it('owns what it derives', () => {
    for (const path of ['level', 'ancestry', 'class', 'size', 'speed', 'hp.max', 'ac.rank']) {
      expect(isDerivedPath(path), path).toBe(true);
    }
  });

  it('owns a path beneath one it derives, not just the root', () => {
    // The sheet binds `lores.0.rank`; the derivation owns `lores` whole.
    expect(isDerivedPath('lores')).toBe(true);
    expect(isDerivedPath('lores.0.rank')).toBe(true);
    expect(isDerivedPath('abilities.str')).toBe(true);
    expect(isDerivedPath('skills.athletics.rank')).toBe(true);
  });

  it('leaves the player everything it does not set', () => {
    for (const path of ['notes', 'feats', 'items', 'reactions', 'playerName', 'hp.current',
      'hp.temp', 'conditions', 'heroPoints', 'shield.raised']) {
      expect(isDerivedPath(path), path).toBe(false);
    }
  });

  it('leaves subclass alone, because nothing can choose one yet', () => {
    // A bloodline or instinct is a real choice with no slot for it. Deriving it
    // would lock the sheet's field and leave nowhere to set it.
    expect(isDerivedPath('subclass')).toBe(false);
    expect(deriveCharacter(build(), context).sheet).not.toHaveProperty('subclass');
  });

  it('owns the name only once the build has one', () => {
    expect(isDerivedPath('name', { name: 'Durgan' })).toBe(true);
    expect(isDerivedPath('name', { name: '' })).toBe(false);
    expect(isDerivedPath('name', {})).toBe(false);
  });
});
