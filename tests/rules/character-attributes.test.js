/**
 * Attribute modifiers from chosen boosts.
 *
 * The partial-boost rule is the whole point of these tests. It is checked
 * against the arithmetic in the pinned upstream's `prepareBuildData`, not
 * against a remembered reading of the rulebook, because getting it wrong is
 * silent: every affected character just looks slightly lucky.
 */
import { describe, expect, it } from 'vitest';

import {
  attributeModifiers, boosted, boostProblems,
} from '../../src/rules/character/attributes.js';

/** A conventional level 1 fighter: dwarf, warrior background, Strength key. */
const DWARF_FIGHTER = {
  ancestry: ['con', 'wis', 'str'],
  background: ['str', 'con'],
  class: 'str',
  1: ['str', 'dex', 'con', 'cha'],
};

describe('attribute boosts', () => {
  it('gives a full point below +4 and half a point at or above it', () => {
    expect(boosted(0)).toBe(1);
    expect(boosted(3)).toBe(4);
    expect(boosted(4)).toBe(4.5);
    expect(boosted(4.5)).toBe(5);
  });

  it('builds an ordinary level 1 character', () => {
    const { mods } = attributeModifiers(DWARF_FIGHTER, { flaws: ['cha'], level: 1 });
    // str: ancestry free + background + class + level 1 = +4
    expect(mods.str).toBe(4);
    // con: ancestry + background + level 1 = +3
    expect(mods.con).toBe(3);
    expect(mods.wis).toBe(1);
    expect(mods.dex).toBe(1);
    // cha: boosted once at level 1, flawed once by the ancestry = 0
    expect(mods.cha).toBe(0);
  });

  it('applies the ancestry flaw inside the ancestry section, not at the end', () => {
    // If the flaw were applied last, boosting the flawed attribute from 0 would
    // give +1 then -1 = 0 either way -- so the case that separates them is one
    // where the order changes whether the +4 threshold was crossed.
    const boosts = { ancestry: ['str'], class: 'str', 1: ['str', 'dex', 'con', 'wis'] };
    const { mods } = attributeModifiers(boosts, { flaws: ['str'], level: 1 });
    // ancestry +1 then flaw -1 = 0, class +1 = 1, level 1 +1 = 2
    expect(mods.str).toBe(2);
  });

  it('accumulates half boosts across levels rather than losing them', () => {
    // A character at +4 who boosts the same attribute at 5 and at 10 reaches +5,
    // even though neither boost alone moved the integer.
    const boosts = {
      ancestry: ['str'], background: ['str'], class: 'str',
      1: ['str', 'dex', 'con', 'wis'],
      5: ['str', 'dex', 'con', 'wis'],
      10: ['str', 'dex', 'con', 'wis'],
    };
    expect(attributeModifiers(boosts, { level: 1 }).mods.str).toBe(4);
    // +4.5 truncates to +4: the boost at 5 looks like it did nothing, and did not.
    expect(attributeModifiers(boosts, { level: 5 }).mods.str).toBe(4);
    expect(attributeModifiers(boosts, { level: 5 }).exact.str).toBe(4.5);
    expect(attributeModifiers(boosts, { level: 10 }).mods.str).toBe(5);
  });

  it('ignores boosts chosen for a level the character has not reached', () => {
    const planned = { ...DWARF_FIGHTER, 5: ['str', 'dex', 'con', 'wis'] };
    const now = attributeModifiers(planned, { flaws: ['cha'], level: 1 });
    const later = attributeModifiers(planned, { flaws: ['cha'], level: 5 });
    expect(now.mods.dex).toBe(1);
    expect(later.mods.dex).toBe(2);
  });

  it('raises an apex attribute to at least +4, and only from level 17', () => {
    const boosts = { ancestry: ['int'], class: 'int', 1: ['int', 'dex', 'con', 'wis'] };
    expect(attributeModifiers(boosts, { apex: 'dex', level: 16 }).mods.dex).toBe(1);
    expect(attributeModifiers(boosts, { apex: 'dex', level: 17 }).mods.dex).toBe(4);
    expect(attributeModifiers(boosts, { apex: 'int', level: 17 }).mods.int).toBe(4);
  });

  it('clamps to the range the upstream enforces', () => {
    const many = Object.fromEntries([1, 5, 10, 15, 20].map((l) => [l, ['str', 'dex', 'con', 'wis']]));
    const { mods } = attributeModifiers(
      { ancestry: ['str'], background: ['str'], class: 'str', ...many },
      { level: 20 },
    );
    expect(mods.str).toBeLessThanOrEqual(10);
  });

  it('ignores an attribute that is not one of the six', () => {
    const { mods } = attributeModifiers({ ancestry: ['luck', 'str'] }, { level: 1 });
    expect(mods.str).toBe(1);
    expect(mods).not.toHaveProperty('luck');
  });
});

describe('boost problems', () => {
  const context = { ancestryBoosts: [{}, {}, {}], backgroundBoosts: [{}, {}], level: 1 };

  it('says nothing about a complete level 1 character', () => {
    expect(boostProblems(DWARF_FIGHTER, context)).toEqual([]);
  });

  it('counts what is still to choose rather than filling it in', () => {
    const problems = boostProblems({ ...DWARF_FIGHTER, 1: ['str'] }, context);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'incomplete', got: 1, want: 4 });
    expect(problems[0].message).toContain('3 more boosts');
  });

  it('catches two boosts to the same attribute in one section', () => {
    const problems = boostProblems({ ...DWARF_FIGHTER, 1: ['str', 'str', 'dex', 'con'] }, context);
    expect(problems.some((p) => p.kind === 'duplicate' && p.attribute === 'str')).toBe(true);
  });

  it('asks for a key attribute when none is chosen', () => {
    const { class: _omitted, ...noKey } = DWARF_FIGHTER;
    expect(boostProblems(noKey, context).some((p) => p.section === 'class')).toBe(true);
  });

  it('does not complain about boost levels the character has not reached', () => {
    expect(boostProblems(DWARF_FIGHTER, context).some((p) => p.section === 'level 5')).toBe(false);
    expect(boostProblems(DWARF_FIGHTER, { ...context, level: 5 })
      .some((p) => p.section === 'level 5')).toBe(true);
  });
});
