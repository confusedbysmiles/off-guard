/**
 * The choice timeline.
 *
 * Slot *levels* come from the class document, so these tests use the real
 * fighter and wizard records: a hand-written class would only prove the model
 * agrees with itself, and the schedule is the part that varies per class.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { outstanding, slotsFor } from '../../src/rules/character/slots.js';

const OPTIONS = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);
const dwarf = OPTIONS.ancestry['ancestry:dwarf'];
const human = OPTIONS.ancestry['ancestry:human'];
const acolyte = OPTIONS.background['background:acolyte'];
const fighter = OPTIONS.class['class:fighter'];

const context = { ancestry: dwarf, background: acolyte, klass: fighter, intMod: 0 };
const build = { level: 1, ancestry: 'ancestry:dwarf', class: 'class:fighter' };

const find = (slots, id) => slots.find((s) => s.id === id);

describe('the timeline', () => {
  it('offers the identity choices at level 1', () => {
    const { slots } = slotsFor(build, context);
    for (const id of ['ancestry', 'heritage', 'background', 'class', 'key-attribute']) {
      expect(find(slots, id), id).toBeTruthy();
    }
  });

  it('stops at the character’s level until planning is asked for', () => {
    const { slots } = slotsFor(build, context);
    expect(slots.every((s) => s.level === 1)).toBe(true);
    expect(slots.some((s) => s.id === 'classFeat-2')).toBe(false);
  });

  it('generates the whole plan when asked to look ahead', () => {
    const { slots, planTo } = slotsFor(build, { ...context, planTo: 10 });
    expect(planTo).toBe(10);
    // Fighter takes a class feat at every even level.
    expect(find(slots, 'classFeat-2')).toBeTruthy();
    expect(find(slots, 'classFeat-10')).toBeTruthy();
    expect(find(slots, 'classFeat-11')).toBeUndefined();
  });

  it('uses the class’s own schedule rather than a generic one', () => {
    const { slots } = slotsFor(build, { ...context, planTo: 20 });
    const levelsOf = (kind) => slots.filter((s) => s.kind === kind).map((s) => s.level);
    expect(levelsOf('ancestryFeat')).toEqual(fighter.featLevels.ancestry);
    expect(levelsOf('generalFeat')).toEqual(fighter.featLevels.general);
    expect(levelsOf('skillIncrease')).toEqual(fighter.skillIncreaseLevels);
  });

  it('marks anything above the current level as planned', () => {
    const { slots } = slotsFor({ ...build, level: 4 }, { ...context, planTo: 8 });
    expect(find(slots, 'classFeat-2').planned).toBe(false);
    expect(find(slots, 'classFeat-4').planned).toBe(false);
    expect(find(slots, 'classFeat-6').planned).toBe(true);
  });

  it('carries the filter that answers each slot', () => {
    const { slots } = slotsFor(build, { ...context, planTo: 6 });
    expect(find(slots, 'classFeat-6').filter).toMatchObject({
      kind: 'feat', category: 'class', trait: 'fighter', maxLevel: 6,
    });
    expect(find(slots, 'ancestryFeat-5').filter).toMatchObject({
      category: 'ancestry', trait: 'dwarf',
    });
    // A general feat is open to everybody, so it is narrowed by nothing.
    expect(find(slots, 'generalFeat-3').filter).not.toHaveProperty('trait');
  });

  it('offers a heritage only once an ancestry is chosen', () => {
    const { slots } = slotsFor({ level: 1 }, { ...context, ancestry: null });
    expect(find(slots, 'heritage').blockedBy).toBe('ancestry');
    expect(find(slots, 'heritage').filter.ancestry).toBe(null);
  });
});

describe('attribute boost slots', () => {
  it('asks only for the boosts the ancestry leaves free', () => {
    // Dwarf: Constitution and Wisdom fixed, one free. Human: two free.
    expect(find(slotsFor(build, context).slots, 'ancestry-boosts').count).toBe(1);
    expect(find(slotsFor(build, { ...context, ancestry: human }).slots, 'ancestry-boosts').count).toBe(2);
  });

  it('asks for four at every boost level, and none before they are reached', () => {
    const atOne = slotsFor(build, context).slots.filter((s) => s.kind === 'attributeBoosts');
    expect(atOne.some((s) => s.section === 5)).toBe(false);
    const planned = slotsFor(build, { ...context, planTo: 20 }).slots
      .filter((s) => s.kind === 'attributeBoosts' && typeof s.section === 'number');
    expect(planned.map((s) => s.section)).toEqual([1, 5, 10, 15, 20]);
    expect(planned.every((s) => s.count === 4)).toBe(true);
  });

  it('grows the skill slot when Intelligence does', () => {
    const base = find(slotsFor(build, context).slots, 'trained-skills').count;
    const smarter = find(slotsFor(build, { ...context, intMod: 2 }).slots, 'trained-skills').count;
    expect(smarter).toBe(base + 2);
  });

  it('does not take skills away for a negative Intelligence', () => {
    const base = find(slotsFor(build, context).slots, 'trained-skills').count;
    expect(find(slotsFor(build, { ...context, intMod: -2 }).slots, 'trained-skills').count).toBe(base);
  });
});

describe('what is outstanding', () => {
  it('counts an unfilled slot, and stops counting it once filled', () => {
    const { slots } = slotsFor(build, context);
    const before = outstanding(slots).length;
    const filled = slotsFor({
      ...build, background: 'background:acolyte', heritage: 'heritage:rock-dwarf',
    }, context);
    expect(outstanding(filled.slots).length).toBe(before - 2);
  });

  it('treats a part-filled multiple choice as still outstanding', () => {
    const partial = slotsFor({ ...build, attributes: { 1: ['str', 'dex'] } }, context);
    expect(find(partial.slots, 'boosts-1').empty).toBe(true);
    const complete = slotsFor({ ...build, attributes: { 1: ['str', 'dex', 'con', 'wis'] } }, context);
    expect(find(complete.slots, 'boosts-1').empty).toBe(false);
  });

  it('ignores planned levels when asked what is outstanding now', () => {
    const { slots } = slotsFor({ ...build, level: 2 }, { ...context, planTo: 10 });
    expect(outstanding(slots, 2).every((s) => s.level <= 2)).toBe(true);
    expect(outstanding(slots).length).toBeGreaterThan(outstanding(slots, 2).length);
  });
});
