/**
 * Pathbuilder import.
 *
 * The fixture is a synthetic level 5 fighter in Pathbuilder's documented export
 * shape. It is synthetic on purpose: committing somebody's real build id would
 * put a stranger's character in the repository, and the mapping is about the
 * shape rather than the contents.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  diffImport, mapPathbuilder, modFromScore, PLAY_STATE_PATHS, rankFromBonus,
} from '../../src/shared/pathbuilder.js';
import { statistic } from '../../src/rules/proficiency.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/pathbuilder/fighter-5.json', 'utf8'));

describe('the two scales Pathbuilder uses', () => {
  it('reads proficiency as the bonus it adds, not as a rank index', () => {
    expect(rankFromBonus(0)).toBe('untrained');
    expect(rankFromBonus(2)).toBe('trained');
    expect(rankFromBonus(4)).toBe('expert');
    expect(rankFromBonus(6)).toBe('master');
    expect(rankFromBonus(8)).toBe('legendary');
  });

  it('turns attribute scores into modifiers', () => {
    expect(modFromScore(18)).toBe(4);
    expect(modFromScore(10)).toBe(0);
    expect(modFromScore(7)).toBe(-2);
  });

  it('treats anything unrecognised as untrained rather than throwing', () => {
    expect(rankFromBonus(99)).toBe('untrained');
    expect(rankFromBonus(undefined)).toBe('untrained');
  });
});

describe('mapping a level 5 fighter', () => {
  const { sheet, warnings } = mapPathbuilder(fixture);

  it('carries the identity across', () => {
    expect(sheet.name).toBe('Kestrel Vane');
    expect(sheet.level).toBe(5);
    expect(sheet.ancestry).toBe('Human');
    expect(sheet.heritage).toBe('Versatile Heritage');
    expect(sheet.background).toBe('Field Medic');
    expect(sheet.class).toBe('Fighter');
    expect(sheet.keyAttribute).toBe('str');
  });

  it('finds the subclass among the specials, where Pathbuilder hides it', () => {
    // Fighters have no subclass; this build's specials name none of the known
    // class-feature words, so the field stays empty rather than guessing.
    expect(sheet.subclass).toBe('');
  });

  it('converts attributes to modifiers', () => {
    expect(sheet.abilities).toEqual({ str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 });
  });

  it('sums hit points from the parts, applying Constitution per level', () => {
    // 8 ancestry + (10 class + 3 Con) x 5 levels = 73.
    expect(sheet.hp.max).toBe(73);
  });

  it('maps proficiency ranks', () => {
    expect(sheet.perception.rank).toBe('master');
    expect(sheet.saves.fortitude.rank).toBe('master');
    expect(sheet.saves.reflex.rank).toBe('expert');
    expect(sheet.skills.athletics.rank).toBe('expert');
    expect(sheet.skills.arcana.rank).toBe('untrained');
  });

  it('keeps Lore skills, which the player adds themselves', () => {
    expect(sheet.lores).toEqual([{ name: 'Warfare', rank: 'trained' }]);
  });

  it('maps strikes with a usable damage formula', () => {
    expect(sheet.strikes[0]).toMatchObject({
      name: 'Longsword', mod: 14, damage: '1d8+6', damageType: 'slashing',
    });
    // A weapon with no damage bonus must not produce "1d6+0".
    expect(sheet.strikes[1].damage).toBe('1d6');
  });

  it('agrees with the rules engine on what it imported', () => {
    // Master perception, Wis +1, level 5: 1 + (5 + 6) = 12.
    const perception = statistic({
      attributeMod: sheet.abilities.wis, rank: sheet.perception.rank, level: sheet.level,
    });
    expect(perception.total).toBe(12);
  });

  it('has nothing to warn about for an ordinary build', () => {
    expect(warnings).toEqual([]);
  });
});

describe('what the import refuses to touch', () => {
  const { sheet } = mapPathbuilder(fixture);

  it('produces no free-text sections at all, so they survive a re-import', () => {
    for (const key of ['feats', 'features', 'reactions', 'items', 'notes']) {
      expect(sheet).not.toHaveProperty(key);
    }
  });

  it('never proposes play state', () => {
    const current = {
      hp: { current: 12, max: 60, temp: 4 },
      heroPoints: 2,
      conditions: [{ slug: 'frightened', value: 1 }],
    };
    const changes = diffImport(current, sheet);
    for (const path of PLAY_STATE_PATHS) {
      expect(changes.map((c) => c.path)).not.toContain(path);
    }
    // The character is still hurt after levelling up.
    expect(changes.map((c) => c.path)).toContain('hp.max');
  });
});

describe('the diff shown before anything is overwritten', () => {
  const { sheet } = mapPathbuilder(fixture);

  it('is empty when the sheet already matches', () => {
    expect(diffImport(sheet, sheet)).toEqual([]);
  });

  it('marks a field that did not exist before as new', () => {
    const change = diffImport({}, sheet).find((c) => c.path === 'name');
    expect(change).toMatchObject({ path: 'name', from: null, to: 'Kestrel Vane', isNew: true });
  });

  it('shows both sides of a changed field', () => {
    const current = { ...sheet, level: 4 };
    const change = diffImport(current, sheet).find((c) => c.path === 'level');
    expect(change).toMatchObject({ from: 4, to: 5, isNew: false });
  });

  it('leaves a hand-typed section out of the diff entirely', () => {
    const current = { notes: 'Owes the innkeeper 4 gp', feats: 'Power Attack' };
    const paths = diffImport(current, sheet).map((c) => c.path);
    expect(paths).not.toContain('notes');
    expect(paths).not.toContain('feats');
  });
});

describe('a file that is not a Pathbuilder export', () => {
  it('warns rather than throwing', () => {
    expect(mapPathbuilder(null).warnings[0]).toMatch(/does not look like/);
    expect(mapPathbuilder({ hello: 'world' }).sheet.name).toBe('');
  });

  it('survives an export missing whole sections', () => {
    const { sheet } = mapPathbuilder({ build: { name: 'Sparse', level: 1 } });
    expect(sheet.name).toBe('Sparse');
    expect(sheet.strikes).toEqual([]);
    expect(sheet.skills.athletics.rank).toBe('untrained');
  });
});
