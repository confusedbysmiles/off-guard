import { describe, expect, it } from 'vitest';

import { recallKnowledge, skillsFor } from '../../src/rules/recall-knowledge.js';
import { loadFixtures } from '../fixtures/index.js';

const { creatures } = loadFixtures();

describe('which skill identifies what', () => {
  it('maps a humanoid to Society', () => {
    const skills = skillsFor(creatures.get('goblin-warrior')).map((s) => s.skill);
    expect(skills).toContain('society');
  });

  it('maps undead to Religion', () => {
    expect(skillsFor(creatures.get('lich')).map((s) => s.skill)).toContain('religion');
  });

  it('offers both skills where a trait lists two', () => {
    const skills = skillsFor({ traits: ['construct'] }).map((s) => s.skill);
    expect(skills).toContain('arcana');
    expect(skills).toContain('crafting');
  });

  it('records which trait brought each skill in', () => {
    const dragon = skillsFor(creatures.get('cinder-dragon-ancient'));
    const arcana = dragon.find((s) => s.skill === 'arcana');
    expect(arcana.viaTraits).toContain('dragon');
  });

  it('always offers Lore, including when no trait matches', () => {
    const none = skillsFor({ traits: ['nonsense'] });
    expect(none).toHaveLength(1);
    expect(none[0].skill).toBe('lore');
  });
});

describe('the DC', () => {
  it('is the level DC for a common creature', () => {
    expect(recallKnowledge(creatures.get('goblin-warrior')).dc.dc).toBe(13);
  });

  it('takes the creature’s own rarity adjustment', () => {
    const lich = recallKnowledge(creatures.get('lich'));
    expect(lich.creature.rarity).toBe('rare');
    expect(lich.dc.base).toBe(30);
    expect(lich.dc.rarityAdjustment).toBe(5);
    expect(lich.dc.dc).toBe(35);
  });

  it('accepts a GM difficulty adjustment on top', () => {
    expect(recallKnowledge(creatures.get('goblin-warrior'), { difficulty: 'hard' }).dc.dc).toBe(15);
  });
});

describe('facts', () => {
  const goblin = creatures.get('goblin-warrior');

  it('lists defences before offence before abilities', () => {
    const keys = recallKnowledge(goblin).facts.map((f) => f.key);
    expect(keys.indexOf('ac')).toBeLessThan(keys.findIndex((k) => k.startsWith('strike.')));
    expect(keys.findIndex((k) => k.startsWith('strike.')))
      .toBeLessThan(keys.findIndex((k) => k.startsWith('ability.')));
  });

  it('marks the ones the GM has revealed', () => {
    const rk = recallKnowledge(goblin, { revealed: ['ac', 'hp'] });
    expect(rk.facts.find((f) => f.key === 'ac').revealed).toBe(true);
    expect(rk.facts.find((f) => f.key === 'perception').revealed).toBe(false);
  });

  it('says its ordering is advisory rather than a rule', () => {
    expect(recallKnowledge(goblin).factOrderIsAdvisory).toBe(true);
  });

  it('includes weaknesses, which is what a table actually asks about', () => {
    const troll = recallKnowledge(creatures.get('forest-troll'));
    expect(troll.facts.some((f) => f.key.startsWith('weaknesses.'))).toBe(true);
  });
});
