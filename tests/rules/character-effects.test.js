/**
 * The effects layer.
 *
 * Two rules do nearly all the work and both are easy to get subtly wrong: what
 * stacks with what, and which numbers an attribute-keyed condition reaches.
 * Everything here is one of those two.
 */
import { describe, expect, it } from 'vitest';

import { effectsOn, stack } from '../../src/rules/character/effects.js';

const sheet = (extra = {}) => ({ level: 5, keyAttribute: 'str', ...extra });
const on = (s, target, context) => effectsOn(s).on(target, context).total;

describe('stacking', () => {
  it('takes the highest bonus of a type and ignores the rest', () => {
    expect(stack([
      { type: 'status', value: 1 },
      { type: 'status', value: 3 },
      { type: 'status', value: 2 },
    ]).total).toBe(3);
  });

  it('takes the worst penalty of a type and ignores the rest', () => {
    expect(stack([
      { type: 'status', value: -1 },
      { type: 'status', value: -3 },
    ]).total).toBe(-3);
  });

  it('applies a bonus and a penalty of the same type at once', () => {
    // Heroism and frightened are both status, and a character under both is
    // at the sum -- they are two contests, not one.
    expect(stack([
      { type: 'status', value: 2 },
      { type: 'status', value: -3 },
    ]).total).toBe(-1);
  });

  it('lets different types stack', () => {
    expect(stack([
      { type: 'status', value: 2 },
      { type: 'circumstance', value: 1 },
      { type: 'item', value: 1 },
    ]).total).toBe(4);
  });

  it('stacks every untyped modifier, including with each other', () => {
    expect(stack([
      { type: 'untyped', value: -2 },
      { type: 'untyped', value: -2 },
      { value: 1 },
    ]).total).toBe(-3);
  });

  it('keeps the parts, so a row can say what happened to it', () => {
    const { parts } = stack([
      { type: 'status', value: -2, from: 'frightened 2' },
      { type: 'status', value: -1, from: 'fatigued' },
      { type: 'circumstance', value: -2, from: 'off-guard' },
    ]);
    expect(parts.map((p) => p.from).sort()).toEqual(['frightened 2', 'off-guard']);
  });

  it('ignores a modifier worth nothing', () => {
    expect(stack([{ type: 'status', value: 0 }, { type: 'status', value: null }]).parts)
      .toEqual([]);
  });
});

describe('frightened', () => {
  const frightened = sheet({ conditions: [{ slug: 'frightened', value: 2 }] });

  it('lowers Armour Class, which is the part people forget', () => {
    // "a status penalty equal to this value to all your checks and DCs", and
    // AC is a DC.
    expect(on(frightened, 'ac')).toBe(-2);
  });

  it('lowers every save, skill, Perception and attack roll', () => {
    for (const target of ['saves.will', 'saves.reflex', 'skills.athletics',
      'skills.stealth', 'perception', 'classDc', 'strike.attack']) {
      expect(on(frightened, target), target).toBe(-2);
    }
  });

  it('does not touch damage or Speed, which are neither checks nor DCs', () => {
    expect(on(frightened, 'strike.damage')).toBe(0);
    expect(on(frightened, 'speed')).toBe(0);
  });
});

describe('the attribute-keyed conditions', () => {
  it('sends clumsy to Dexterity and nowhere else', () => {
    const s = sheet({ conditions: [{ slug: 'clumsy', value: 2 }] });
    expect(on(s, 'ac')).toBe(-2);
    expect(on(s, 'saves.reflex')).toBe(-2);
    expect(on(s, 'skills.stealth')).toBe(-2);
    expect(on(s, 'skills.acrobatics')).toBe(-2);
    expect(on(s, 'skills.thievery')).toBe(-2);
    // Not these.
    expect(on(s, 'saves.will')).toBe(0);
    expect(on(s, 'saves.fortitude')).toBe(0);
    expect(on(s, 'skills.athletics')).toBe(0);
  });

  it('sends enfeebled to Strength, including the damage roll', () => {
    const s = sheet({ conditions: [{ slug: 'enfeebled', value: 1 }] });
    expect(on(s, 'skills.athletics')).toBe(-1);
    // A Strength-based class DC: this character's key attribute is Strength.
    expect(on(s, 'classDc')).toBe(-1);
    expect(on(s, 'saves.reflex')).toBe(0);
    expect(on(s, 'ac')).toBe(0);
  });

  it('sends stupefied to all three mental attributes', () => {
    const s = sheet({ conditions: [{ slug: 'stupefied', value: 3 }] });
    expect(on(s, 'saves.will')).toBe(-3);
    expect(on(s, 'perception')).toBe(-3);       // Wisdom
    expect(on(s, 'skills.occultism')).toBe(-3); // Intelligence
    expect(on(s, 'skills.deception')).toBe(-3); // Charisma
    expect(on(s, 'skills.athletics')).toBe(0);
    expect(on(s, 'ac')).toBe(0);
  });

  it('reaches a Lore, which no list of skills can name', () => {
    const frightened = sheet({ conditions: [{ slug: 'frightened', value: 1 }] });
    const stupefied = sheet({ conditions: [{ slug: 'stupefied', value: 2 }] });
    const clumsy = sheet({ conditions: [{ slug: 'clumsy', value: 2 }] });

    expect(on(frightened, 'skills.lore')).toBe(-1);
    // A Lore is an Intelligence skill, so stupefied finds it and clumsy does not.
    expect(on(stupefied, 'skills.lore')).toBe(-2);
    expect(on(clumsy, 'skills.lore')).toBe(0);
  });

  it('tells a rapier’s attack from its damage', () => {
    // Attacks with Dexterity, damages with Strength, so each condition finds
    // a different half of the same strike.
    const rapier = { components: { attribute: 'dex', damageAttribute: 'str' } };
    const clumsy = sheet({ conditions: [{ slug: 'clumsy', value: 1 }] });
    const enfeebled = sheet({ conditions: [{ slug: 'enfeebled', value: 1 }] });

    expect(on(clumsy, 'strike.attack', { strike: rapier })).toBe(-1);
    expect(on(clumsy, 'strike.damage', { strike: rapier })).toBe(0);
    expect(on(enfeebled, 'strike.attack', { strike: rapier })).toBe(0);
    expect(on(enfeebled, 'strike.damage', { strike: rapier })).toBe(-1);
  });

  it('leaves a bow’s damage alone when its wielder is enfeebled', () => {
    const bow = { components: { attribute: 'dex', damageAttribute: null } };
    const s = sheet({ conditions: [{ slug: 'enfeebled', value: 2 }] });
    expect(on(s, 'strike.damage', { strike: bow })).toBe(0);
  });
});

describe('the conditions that are not simply a penalty', () => {
  it('charges drained to Fortitude and to maximum hit points', () => {
    const s = sheet({ level: 5, conditions: [{ slug: 'drained', value: 2 }] });
    expect(on(s, 'saves.fortitude')).toBe(-2);
    // "Hit Points equal to your level (minimum 1) times the drained value"
    expect(effectsOn(s).hpMaxPenalty).toBe(-10);
    expect(on(s, 'saves.will')).toBe(0);
  });

  it('charges off-guard as a circumstance penalty, so it stacks with a status one', () => {
    const s = sheet({
      conditions: [{ slug: 'off-guard' }, { slug: 'frightened', value: 1 }],
    });
    expect(on(s, 'ac')).toBe(-3);
  });

  it('does not let encumbered’s clumsy stack with a worse clumsy', () => {
    const s = sheet({
      conditions: [{ slug: 'encumbered' }, { slug: 'clumsy', value: 2 }],
    });
    // Both are status penalties to Dexterity. The worse one applies, alone.
    expect(on(s, 'ac')).toBe(-2);
    expect(on(s, 'speed')).toBe(-10);
  });

  it('ignores the conditions that change what you may do rather than what you roll', () => {
    const s = sheet({
      conditions: [{ slug: 'slowed', value: 1 }, { slug: 'doomed', value: 2 },
        { slug: 'blinded' }, { slug: 'grabbed' }],
    });
    expect(effectsOn(s).any).toBe(false);
    expect(on(s, 'ac')).toBe(0);
  });
});

describe('an effect somebody wrote', () => {
  const rage = {
    id: 'e1',
    name: 'Rage',
    active: true,
    modifiers: [
      { target: 'strike.damage', type: 'status', value: 2 },
      { target: 'ac', type: 'status', value: -1 },
    ],
  };

  it('applies while it is on', () => {
    const s = sheet({ effects: [rage] });
    expect(on(s, 'strike.damage')).toBe(2);
    expect(on(s, 'ac')).toBe(-1);
  });

  it('contributes nothing while it is off', () => {
    const s = sheet({ effects: [{ ...rage, active: false }] });
    expect(on(s, 'strike.damage')).toBe(0);
    expect(effectsOn(s).any).toBe(false);
  });

  it('names itself, so the number can say where it came from', () => {
    const s = sheet({ effects: [rage], conditions: [{ slug: 'frightened', value: 2 }] });
    expect(effectsOn(s).names).toEqual(['Rage', 'frightened 2']);
    // Rage's -1 and frightened's -2 are both status penalties to AC, so only
    // the worse one is in play -- and the row says which, rather than showing
    // a -2 that has no visible author.
    expect(effectsOn(s).on('ac')).toEqual({
      total: -2,
      parts: [expect.objectContaining({ from: 'frightened 2', type: 'status', value: -2 })],
    });
  });

  it('names both when they are not competing for the same number', () => {
    const s = sheet({ effects: [rage], conditions: [{ slug: 'off-guard' }] });
    // A status penalty and a circumstance penalty, so both land.
    expect(effectsOn(s).on('ac').total).toBe(-3);
    expect(effectsOn(s).on('ac').parts.map((p) => p.from).sort())
      .toEqual(['Rage', 'off-guard']);
  });

  it('meets a condition of the same type and loses to the bigger one', () => {
    const heroism = {
      name: 'Heroism',
      modifiers: [{ target: 'all', type: 'status', value: 1 }],
    };
    const s = sheet({ effects: [heroism], conditions: [{ slug: 'frightened', value: 3 }] });
    expect(on(s, 'saves.will')).toBe(-2);
  });

  it('survives anything a client might send', () => {
    for (const effects of [null, 'rage', [null], [{}], [{ modifiers: 'lots' }],
      [{ modifiers: [{ target: 'ac', value: 'two' }] }]]) {
      expect(() => effectsOn(sheet({ effects })).on('ac')).not.toThrow();
      expect(on(sheet({ effects }), 'ac')).toBe(0);
    }
  });
});
