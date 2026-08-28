import { describe, expect, it } from 'vitest';
import { loadFixtures, manifest } from './fixtures/index.js';

const { creatures, hazards } = loadFixtures();

describe('fixture set', () => {
  it('covers every elite/weak HP boundary in Monster Core', () => {
    const levels = [...creatures.values()].map((c) => c.level).sort((a, b) => a - b);
    // Boundaries: <=1, 2-4, 5-19, >=20, plus the level -1/0 elite special case.
    for (const level of [-1, 0, 1, 2, 4, 5, 19, 20]) {
      expect(levels, `no fixture at level ${level}`).toContain(level);
    }
    expect(levels.at(-1)).toBeGreaterThanOrEqual(21);
  });

  it('is described by a manifest', () => {
    expect(manifest.fixtures).toHaveLength(creatures.size + hazards.size);
  });
});

describe('identity and provenance', () => {
  it('records book, licence and remaster status', () => {
    expect(creatures.get('forest-troll').source).toMatchObject({
      book: 'Pathfinder Monster Core', license: 'ORC', remaster: true, tier: 'core',
    });
  });

  it('leaves page null, because Foundry carries no page references', () => {
    for (const record of creatures.values()) expect(record.source.page).toBeNull();
  });

  it('derives creature type from the type trait', () => {
    expect(creatures.get('forest-troll').creatureType).toBe('giant');
    expect(creatures.get('ghost-mage').creatureType).toBe('spirit');
    expect(creatures.get('lich').creatureType).toBe('undead');
  });
});

describe('defences', () => {
  it('parses regeneration out of the free-text HP details', () => {
    expect(creatures.get('forest-troll').hp).toMatchObject({
      max: 125,
      regeneration: { amount: 20, deactivatedBy: 'electricity or fire' },
      fastHealing: null,
    });
  });

  it('keeps the original HP details string even when parsed', () => {
    expect(creatures.get('forest-troll').hp.details).toMatch(/regeneration 20/);
  });

  it('renders resistance exceptions and doubleVs as prose', () => {
    expect(creatures.get('ghost-mage').resistances[0].label).toBe(
      'all damage 10 (except force, ghost touch, spirit, or vitality; double vs. non-magical)'
    );
  });

  it('recovers IWR that exists only as a rule element, with its source', () => {
    const derived = creatures.get('lich').derivedIwr.resistances;
    expect(derived[0].label).toBe('physical 10 (except magical bludgeoning)');
    expect(derived[0].source).toBe('Void Healing');
  });

  it('keeps the all-saves note', () => {
    expect(creatures.get('lich').saves.allNote).toMatch(/vitality/);
  });
});

describe('speeds', () => {
  it('omits a zero land speed rather than printing "0 feet"', () => {
    const ghost = creatures.get('ghost-mage');
    expect(ghost.speeds.land).toBe(0);
    expect(ghost.speeds.label).toBe('fly 25 feet');
  });

  it('lists land and other speeds together', () => {
    expect(creatures.get('forest-troll').speeds.label).toBe('30 feet');
  });
});

describe('strikes and inventory', () => {
  const goblin = creatures.get('goblin-warrior');

  it('separates strikes from the items line', () => {
    expect(goblin.strikes.map((s) => s.name)).toEqual(['Dogslicer', 'Shortbow']);
    expect(goblin.items.map((i) => i.name)).toEqual(
      ['Dogslicer', 'Shortbow', 'Leather Armor', 'Arrows']
    );
  });

  it('classifies a strike as ranged by its range increment', () => {
    expect(goblin.strikes.find((s) => s.name === 'Shortbow')).toMatchObject({
      kind: 'ranged', mod: 7, range: { increment: 60 },
    });
    expect(goblin.strikes.find((s) => s.name === 'Dogslicer').kind).toBe('melee');
  });

  it('keeps damage as formula plus type', () => {
    expect(creatures.get('forest-troll').strikes[0].damage).toEqual([
      { formula: '2d10+5', type: 'piercing', category: null },
    ]);
  });
});

describe('abilities', () => {
  it('splits abilities by action cost, including free actions', () => {
    const lich = creatures.get('lich');
    expect(Object.keys(lich.abilities)).toEqual(['passive', 'action', 'reaction', 'free']);
    expect(lich.abilities.free.map((a) => a.name)).toContain('Drain Soul Cage');
  });

  it('inlines glossary text that is not in the creature file at all', () => {
    const regeneration = creatures.get('forest-troll').abilities.passive
      .find((a) => /^Regeneration/.test(a.name));
    expect(regeneration.text.text).toMatch(/regains the listed number of Hit Points/);
  });

  it('records action cost as a count', () => {
    const rend = creatures.get('forest-troll').abilities.action.find((a) => a.name === 'Rend');
    expect(rend.cost).toEqual({ type: 'action', count: 1 });
  });
});

describe('spellcasting', () => {
  it('reads an innate entry, using the heightened rank', () => {
    const [entry] = creatures.get('sprite').spellcasting;
    expect(entry).toMatchObject({ kind: 'innate', tradition: 'primal', dc: 16 });
    expect(entry.ranks[0].spells.map((s) => s.name).sort())
      .toEqual(['Daze', 'Detect Magic', 'Dizzying Colors', 'Light']);
  });

  it('reads a prepared entry, keeping repeat preparations', () => {
    const [entry] = creatures.get('lich').spellcasting;
    expect(entry.kind).toBe('prepared');
    expect(entry.dc).toBe(36);
    const rank6 = entry.ranks.find((r) => r.rank === 6);
    expect(rank6.slotsMax).toBeGreaterThan(0);
    expect(rank6.spells.length).toBeGreaterThan(0);
  });

  it('sorts ranks highest first', () => {
    const [entry] = creatures.get('lich').spellcasting;
    const ranks = entry.ranks.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });
});

describe('hazards', () => {
  it('normalizes a simple hazard', () => {
    expect(hazards.get('hidden-pit')).toMatchObject({
      kind: 'hazard', level: 0, complex: false,
    });
    expect(hazards.get('hidden-pit').stealth.dc).toBe(8);
    expect(hazards.get('hidden-pit').hp.hardness).toBe(3);
  });

  it('flags a complex hazard, which is costed as a full creature', () => {
    expect(hazards.get('drowning-pit').complex).toBe(true);
  });

  it('resolves markup in the disable entry', () => {
    expect(hazards.get('hidden-pit').disable.text).toBe(
      'DC 12 Thievery (Remove the Trapdoor) to remove the trapdoor'
    );
  });
});

describe('every fixture normalizes without holes', () => {
  it.each([...creatures.keys()])('%s', (id) => {
    const c = creatures.get(id);
    expect(c.name).toBeTruthy();
    expect(Number.isInteger(c.level)).toBe(true);
    expect(c.ac.value).toBeGreaterThan(0);
    expect(c.hp.max).toBeGreaterThan(0);
    expect(c.size.label).toBeTruthy();
    expect(c.source.book).toBeTruthy();
    // No unrendered Foundry markup may reach the record.
    expect(JSON.stringify(c)).not.toMatch(/@(UUID|Damage|Check|Localize|Template)\[/);
    expect(JSON.stringify(c)).not.toContain('[object Object]');
  });
});
