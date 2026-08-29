/**
 * The transcribed GM Core creature-building tables.
 *
 * These numbers come out of a PDF that is not in the repository, by a script
 * nobody will run again for years. If a re-extraction ever goes wrong -- a
 * different printing, a changed text layer, a parser that shifts one column --
 * the damage is a wrong number in a live game with nothing to trace it to.
 *
 * So: a handful of cells copied by eye from the book, and the structural
 * properties every one of these tables has.
 */
import { describe, expect, it } from 'vitest';

import { CREATURE_BUILDING, SCALING_SOURCE } from '../../src/rules/tables/creature-scaling.js';

const LEVELS = [-1, ...Array.from({ length: 25 }, (_, i) => i)];
const TABLES = Object.entries(CREATURE_BUILDING);

const cell = (table, level, name) => {
  const { columns, rows } = CREATURE_BUILDING[table];
  return rows[String(level)][columns.indexOf(name)];
};

describe('cells read off the printed page', () => {
  it.each([
    // GM Core pg. 117, Armor Class.
    ['ac', 1, 'extreme', 19], ['ac', 1, 'low', 13],
    ['ac', 12, 'high', 33], ['ac', 24, 'moderate', 50],
    // pg. 115, Perception. Level -1 has no extreme column value above +9.
    ['perception', -1, 'extreme', 9], ['perception', 10, 'terrible', 14],
    // pg. 118, Saving Throws -- the same numbers as Perception, as printed.
    ['save', 5, 'high', 15], ['save', 20, 'terrible', 27],
    // pg. 116, Skills. The low column is printed as a range, "+8 to +7".
    ['skill', 4, 'extreme', 15], ['skill', 4, 'low', 8],
    // pg. 118, Hit Points, printed as ranges: level 5 moderate is 78-72.
    ['hp', 5, 'moderate', 75], ['hp', 1, 'high', 25], ['hp', 24, 'low', 375],
    // pg. 120, Strike Attack Bonus and Strike Damage (the printed average).
    ['attack', 6, 'extreme', 19], ['attack', 17, 'low', 27],
    ['damage', 5, 'high', 16], ['damage', 19, 'extreme', 55],
    // pg. 121, Spell DC and Spell Attack Modifier.
    ['spellDc', 15, 'extreme', 40], ['spellAttack', 15, 'moderate', 25],
    // pg. 114, Attribute Modifier Scales. Levels -1 and 0 print an em dash.
    ['attribute', -1, 'extreme', null], ['attribute', 20, 'high', 10],
  ])('%s, level %i, %s is %s', (table, level, name, expected) => {
    expect(cell(table, level, name)).toBe(expected);
  });

  it('says where it came from', () => {
    expect(SCALING_SOURCE).toBe('GM Core pp. 114–121');
    for (const [, table] of TABLES) {
      expect(table.citation).toMatch(/^GM Core pg\. 1(1[4-9]|2[01])$/);
    }
  });
});

describe('every table', () => {
  it.each(TABLES)('%s covers level -1 to 24 with no gaps', (name, table) => {
    expect(Object.keys(table.rows).map(Number).sort((a, b) => a - b)).toEqual(LEVELS);
    for (const level of LEVELS) {
      expect(table.rows[String(level)], `${name} level ${level}`).toHaveLength(table.columns.length);
    }
  });

  it.each(TABLES)('%s has columns that descend at every level', (name, table) => {
    for (const level of LEVELS) {
      const row = table.rows[String(level)].filter((v) => v !== null);
      for (let i = 1; i < row.length; i += 1) {
        expect(row[i], `${name} level ${level} column ${i}`).toBeLessThanOrEqual(row[i - 1]);
      }
    }
  });

  it.each(TABLES)('%s never goes down as the level goes up', (name, table) => {
    // The one property that makes scaling monotonic: moving a creature up a
    // level can never make a statistic worse.
    for (let i = 1; i < LEVELS.length; i += 1) {
      const lower = table.rows[String(LEVELS[i - 1])];
      const upper = table.rows[String(LEVELS[i])];
      upper.forEach((value, c) => {
        if (value === null || lower[c] === null) return;
        expect(value, `${name} level ${LEVELS[i]} column ${c}`).toBeGreaterThanOrEqual(lower[c]);
      });
    }
  });
});
