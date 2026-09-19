/**
 * A background somebody wrote themselves.
 *
 * The catalogue has 514 and a table still needs one it does not have: a GM
 * writes one for their setting, or a book lands before the compendium build
 * catches up. The shape it has to produce is the shape a printed background
 * has -- two boosts, one of them narrowed; one trained skill; one Lore -- so
 * that everything downstream cannot tell the difference.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { customBackground, isCustomBackground, resolveBackground } from '../../src/rules/character/background.js';
import { deriveCharacter } from '../../src/rules/character/derive.js';
import { slotsFor } from '../../src/rules/character/slots.js';

const OPTIONS = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);
const dwarf = OPTIONS.ancestry['ancestry:dwarf'];
const fighter = OPTIONS.class['class:fighter'];
const acolyte = OPTIONS.background['background:acolyte'];

const CARAVAN = {
  name: 'Caravan guard',
  boosts: ['str', 'con'],
  skill: 'athletics',
  lore: 'Caravan Lore',
  feat: 'Hefty Hauler',
};

describe('what a described background becomes', () => {
  it('has the shape a printed one has', () => {
    const printed = customBackground(CARAVAN);
    // Two boosts, both the player's to place, the first narrowed to a list.
    expect(printed.boosts).toHaveLength(acolyte.boosts.length);
    expect(printed.boosts[0]).toEqual({ free: true, options: ['str', 'con'] });
    expect(printed.boosts[1].options).toHaveLength(6);
    expect(printed.trainedSkills).toEqual(['athletics']);
    expect(printed.trainedLore).toEqual(['Caravan Lore']);
  });

  it('offers all six when the list was left empty', () => {
    // "None selected" reads as no restriction, not as no boost: a background
    // that granted nothing would be one that is wrong rather than generous.
    expect(customBackground({ name: 'Drifter' }).boosts[0].options).toHaveLength(6);
    expect(customBackground({ name: 'Drifter', boosts: [] }).boosts[0].options).toHaveLength(6);
  });

  it('drops an attribute or a skill the rules have no meaning for', () => {
    const nonsense = customBackground({
      name: 'Nonsense', boosts: ['str', 'strength', 'luck'], skill: 'lockpicking',
    });
    expect(nonsense.boosts[0].options).toEqual(['str']);
    expect(nonsense.trainedSkills).toEqual([]);
  });

  it('does not let the same attribute be offered twice', () => {
    expect(customBackground({ boosts: ['str', 'str', 'con'] }).boosts[0].options)
      .toEqual(['str', 'con']);
  });

  it('always has a name, because everything downstream prints one', () => {
    expect(customBackground({}).name).toBe('Custom background');
    expect(customBackground({ name: '   ' }).name).toBe('Custom background');
    expect(customBackground({ name: 'x'.repeat(200) }).name).toHaveLength(60);
  });

  /**
   * A granted feat is recorded and never applied -- which is also true of a
   * catalogue background's. See the note in `derive.js` about what a feat
   * mechanically does.
   */
  it('records the skill feat without pretending to grant it', () => {
    const printed = customBackground(CARAVAN);
    expect(printed.grantedFeat).toBe('Hefty Hauler');
    expect(printed).not.toHaveProperty('feats');
  });
});

describe('choosing one, or writing one', () => {
  const lookUp = (id) => OPTIONS.background[id] ?? null;

  it('takes a string as a catalogue id', () => {
    expect(resolveBackground('background:acolyte', lookUp)).toBe(acolyte);
  });

  it('takes an object as a description', () => {
    expect(resolveBackground({ custom: CARAVAN }, lookUp).name).toBe('Caravan guard');
  });

  it('is nothing when there is nothing, or when the id has gone', () => {
    expect(resolveBackground(null, lookUp)).toBe(null);
    expect(resolveBackground('', lookUp)).toBe(null);
    // An id the catalogue no longer has is a gap, not a silent substitution.
    expect(resolveBackground('background:nonesuch', lookUp)).toBe(null);
  });

  it('knows which of the two it is looking at', () => {
    expect(isCustomBackground({ custom: CARAVAN })).toBe(true);
    expect(isCustomBackground('background:acolyte')).toBe(false);
    expect(isCustomBackground(null)).toBe(false);
  });
});

describe('a character built on one', () => {
  const build = {
    name: 'Perrin',
    level: 1,
    background: { custom: CARAVAN },
    attributes: { ancestry: [], background: ['str'], class: 'str', 1: ['str', 'dex', 'con', 'cha'] },
    skills: { trained: [], increases: {}, lores: [] },
  };
  const context = {
    ancestry: dwarf,
    background: customBackground(CARAVAN),
    klass: fighter,
    progression: OPTIONS.progression['class:fighter'],
  };

  it('is trained in the skill it names', () => {
    expect(deriveCharacter(build, context).sheet.skills.athletics.rank).toBe('trained');
  });

  it('carries its Lore onto the sheet beside any other', () => {
    expect(deriveCharacter(build, context).sheet.lores)
      .toEqual([{ name: 'Caravan Lore', rank: 'trained' }]);
  });

  it('is what the sheet calls the background', () => {
    expect(deriveCharacter(build, context).sheet.background).toBe('Caravan guard');
  });

  it('offers its narrowed list as a boost to place', () => {
    const { slots } = slotsFor(build, context);
    const boosts = slots.find((slot) => slot.id === 'background-boosts');
    expect(boosts.options[0]).toEqual(['str', 'con']);
    expect(boosts.options[1]).toHaveLength(6);
  });
});

/**
 * Opening the form is not the same as filling it in.
 *
 * Without this the header said "everything chosen" the moment somebody clicked
 * Describe your own, over a background granting nothing at all.
 */
describe('a background half written', () => {
  const slotFor = (background) => slotsFor(
    { background, attributes: {}, skills: {} },
    { ancestry: dwarf, klass: fighter, background: resolveBackground(background, () => null) },
  ).slots.find((slot) => slot.kind === 'background');

  it('is still unanswered until it has a name', () => {
    expect(slotFor({ custom: {} }).empty).toBe(true);
    expect(slotFor({ custom: { skill: 'athletics' } }).empty).toBe(true);
    expect(slotFor({ custom: { name: '  ' } }).empty).toBe(true);
  });

  it('is answered once it does', () => {
    expect(slotFor({ custom: { name: 'Caravan guard' } }).empty).toBe(false);
  });

  it('leaves a chosen one alone', () => {
    expect(slotFor('background:acolyte').empty).toBe(false);
    expect(slotFor(null).empty).toBe(true);
  });
});
