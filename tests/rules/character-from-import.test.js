/**
 * Reading a Pathbuilder export backwards.
 *
 * Pathbuilder exports results, not choices: Strength 18 rather than which four
 * boosts made it, Stealth +11 rather than trained-at-1-and-increased-at-3. So
 * the reconstruction has to work out an account of how the character got here,
 * and the only thing that makes an invented account acceptable is that it
 * produces the same numbers -- which is what these tests check, by deriving the
 * reconstruction and comparing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { attributeModifiers, ATTRIBUTES } from '../../src/rules/character/attributes.js';
import {
  buildFromImport, checkAgainst, solveBoosts, solveSkills,
} from '../../src/rules/character/from-import.js';

const OPTIONS = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);
const dwarf = OPTIONS.ancestry['ancestry:dwarf'];
const human = OPTIONS.ancestry['ancestry:human'];
const acolyte = OPTIONS.background['background:acolyte'];
const fighter = OPTIONS.class['class:fighter'];

/** What the solved boosts actually come to, through the real arithmetic. */
const modsOf = (picks, { ancestry, level = 1 }) => attributeModifiers(
  {
    ...picks,
    ancestry: [
      ...(ancestry?.boosts ?? []).filter((b) => !b.free).map((b) => b.options[0]),
      ...picks.ancestry,
    ],
  },
  { flaws: ancestry?.flaws ?? [], level },
).mods;

const target = (partial) => ({
  ...Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])), ...partial,
});

/**
 * Round trips, rather than arrays somebody typed.
 *
 * The first version of these tests asserted against attribute spreads written
 * by hand, and two of them were not reachable at all -- a level 1 character
 * cannot have Strength +4 and Constitution +3, because both want the same four
 * sections. The solver was right and the test was wrong, which is the least
 * useful way for a test to fail. So a legal set of boosts is built first, its
 * modifiers are taken as the target, and the solver has to find its way back.
 */
describe('working out which boosts were taken', () => {
  const roundTrip = (picks, context) => {
    const wanted = modsOf(picks, context);
    const found = solveBoosts(wanted, {
      ancestry: context.ancestry,
      background: context.background ?? acolyte,
      klass: fighter,
      keyAttribute: picks.class,
      level: context.level ?? 1,
    });
    return { wanted, got: modsOf(found, context), found };
  };

  it('reproduces a dwarf’s modifiers exactly, flaw and all', () => {
    const { wanted, got } = roundTrip({
      ancestry: ['str'], background: ['wis', 'str'], class: 'str',
      1: ['str', 'con', 'dex', 'int'], 5: [], 10: [], 15: [], 20: [],
    }, { ancestry: dwarf });
    expect(wanted.cha).toBe(-1);
    expect(got).toEqual(wanted);
  });

  it('reproduces a human’s, who has no fixed boosts at all', () => {
    const { wanted, got } = roundTrip({
      ancestry: ['str', 'int'], background: ['int', 'str'], class: 'str',
      1: ['str', 'con', 'dex', 'wis'], 5: [], 10: [], 15: [], 20: [],
    }, { ancestry: human });
    expect(wanted.str).toBe(4);
    expect(got).toEqual(wanted);
  });

  it('uses the later boost levels a higher-level character has had', () => {
    const { wanted, got, found } = roundTrip({
      ancestry: ['str', 'con'], background: ['int', 'dex'], class: 'str',
      1: ['str', 'con', 'dex', 'wis'], 5: ['str', 'con', 'dex', 'wis'],
      10: ['str', 'con', 'dex', 'cha'], 15: [], 20: [],
    }, { ancestry: human, level: 10 });
    expect(got).toEqual(wanted);
    expect(found[5].length).toBeGreaterThan(0);
    expect(found[10].length).toBeGreaterThan(0);
  });

  /**
   * The class's key attribute is forced, and it lands after the free choices.
   * Without reserving it the free choices spend what the class was about to
   * give, and a Strength of +1 comes out as +2.
   */
  it('leaves a slot empty rather than spending it on an overshoot', () => {
    const wanted = target({ str: 1 });
    const picks = solveBoosts(wanted, {
      ancestry: human, background: null, klass: fighter, keyAttribute: 'str', level: 1,
    });
    expect(modsOf(picks, { ancestry: human })).toEqual(wanted);
    expect(picks[1].length).toBeLessThan(4);
  });

  it('respects a background that narrows its first boost', () => {
    const picks = solveBoosts(target({ int: 2, wis: 1, str: 1 }), {
      ancestry: human, background: acolyte, klass: fighter, keyAttribute: 'str', level: 1,
    });
    // Acolyte offers Intelligence or Wisdom for the first, anything for the second.
    expect(acolyte.boosts[0].options).toContain(picks.background[0]);
  });
});

describe('working out which skills were trained and increased', () => {
  const proficiencies = { athletics: 4, stealth: 2, religion: 2, medicine: 6 };

  it('trains what the background and class did not', () => {
    const { trained } = solveSkills(proficiencies, { background: acolyte, klass: fighter, level: 7 });
    // Religion comes from the Acolyte background, so it was not a choice.
    expect(trained).not.toContain('religion');
    expect(trained).toEqual(expect.arrayContaining(['athletics', 'stealth', 'medicine']));
  });

  /**
   * The rank minimums are the whole reason this is not a simple zip: a class
   * can offer a skill increase at a level where the rank it would produce is
   * not yet legal, and `skillRanks` refuses it -- leaving the skill a rank low
   * and nothing said about it.
   */
  it('never places an increase at a level where the rank is not legal yet', () => {
    const early = { ...fighter, skillIncreaseLevels: [2, 3, 5, 7, 9] };
    const { increases } = solveSkills(proficiencies, { background: acolyte, klass: early, level: 9 });
    expect(increases[2]).toBeUndefined();
    // Medicine is master, which needs level 7 or later for its second step.
    const medicineLevels = Object.entries(increases)
      .filter(([, skill]) => skill === 'medicine').map(([l]) => Number(l));
    expect(Math.max(...medicineLevels)).toBeGreaterThanOrEqual(7);
  });

  it('says how many increases it could not place', () => {
    const { unplaced } = solveSkills(
      { athletics: 8, stealth: 6 },
      { background: acolyte, klass: { ...fighter, skillIncreaseLevels: [3] }, level: 3 },
    );
    expect(unplaced).toBeGreaterThan(0);
  });
});

describe('the whole build', () => {
  const find = (kind, name) => {
    const shelf = OPTIONS[kind] ?? {};
    return Object.values(shelf).find((record) => record.name === name) ?? null;
  };

  const exported = {
    build: {
      name: 'Durgan', level: 3, ancestry: 'Dwarf', background: 'Acolyte', class: 'Fighter',
      keyability: 'str', abilities: { str: 18, dex: 12, con: 16, int: 10, wis: 14, cha: 8 },
      money: { pp: 0, gp: 12, sp: 4, cp: 0 },
      lores: [['Warfare', 2]],
      proficiencies: { athletics: 2, religion: 2 },
    },
  };

  it('resolves the names it was given into catalogue ids', () => {
    const { build } = buildFromImport(exported, { find, sheet: { abilities: {} } });
    expect(build.ancestry).toBe('ancestry:dwarf');
    expect(build.background).toBe('background:acolyte');
    expect(build.class).toBe('class:fighter');
    expect(build.level).toBe(3);
  });

  it('says which name it could not find rather than guessing at a near one', () => {
    const { build, notes } = buildFromImport(
      { build: { ...exported.build, ancestry: 'Dwarfe' } },
      { find, sheet: { abilities: {} } },
    );
    expect(build.ancestry).toBe(null);
    expect(notes.join(' ')).toMatch(/Dwarfe/);
  });

  it('carries the purse and names a Lore properly', () => {
    const { build } = buildFromImport(exported, { find, sheet: { abilities: {} } });
    expect(build.coins).toEqual({ pp: 0, gp: 12, sp: 4, cp: 0 });
    // Pathbuilder writes "Warfare"; the sheet calls it "Warfare Lore".
    expect(build.skills.lores).toEqual([{ name: 'Warfare Lore', rank: 'trained' }]);
  });

  it('does not write down the Lore the background already grants', () => {
    const withScribing = { build: { ...exported.build, lores: [['Scribing', 2]] } };
    const { build } = buildFromImport(withScribing, { find, sheet: { abilities: {} } });
    expect(build.skills.lores).toEqual([]);
  });
});

describe('checking the reconstruction against the file', () => {
  it('finds nothing when the two agree', () => {
    const sheet = { abilities: { str: 4 }, hp: { max: 40 }, skills: { stealth: { rank: 'expert' } } };
    expect(checkAgainst(sheet, sheet)).toEqual([]);
  });

  it('names both values, so the player can judge which they want', () => {
    const differences = checkAgainst(
      { abilities: { str: 4 }, hp: { max: 40 } },
      { abilities: { str: 3 }, hp: { max: 40 } },
    );
    expect(differences).toEqual([
      expect.objectContaining({ path: 'abilities.str', imported: 4, derived: 3 }),
    ]);
  });
});
