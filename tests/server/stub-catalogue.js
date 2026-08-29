/**
 * A catalogue of three creatures, built by hand.
 *
 * The real one needs `npm run build:data`; the dashboard and the tracker do not
 * depend on which creatures exist, and a test that needs a 66 MB build is a test
 * nobody runs.
 */
import { openCatalogue } from '../../src/server/catalogue.js';

export function stubCatalogue() {
  const make = (id, name, level, traits = [], rarity = 'common') => ({
    id, name, level, rarity, traits, creatureType: traits[0] ?? null,
    size: { code: 'med', label: 'Medium' },
    source: { book: 'Test', pack: 'test', license: 'ORC', remaster: true, page: null, tier: 'core' },
    perception: { mod: level + 5, senses: [], sensesLabel: null, details: null },
    languages: { value: [], details: null },
    // Two skills, so a test can tell "roll Stealth" apart from "roll Perception"
    // and can check the fallback when the creature has neither.
    skills: [
      { slug: 'stealth', label: 'Stealth', mod: level + 7, note: null, special: [] },
      { slug: 'athletics', label: 'Athletics', mod: level + 4, note: null, special: [] },
    ],
    abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    ac: { value: 15 + level, details: null },
    saves: {
      fortitude: { mod: level + 6, note: null },
      reflex: { mod: level + 4, note: null },
      will: { mod: level + 3, note: null },
      allNote: null,
    },
    hp: { max: 20 + level * 10, details: null, regeneration: null, fastHealing: null, hardness: null },
    immunities: [], weaknesses: [], resistances: [],
    derivedIwr: { immunities: [], weaknesses: [], resistances: [] },
    speeds: { land: 25, other: [], details: null, label: '25 feet' },
    items: [], strikes: [], spellcasting: [], focus: null,
    abilities: { passive: [], action: [], reaction: [], free: [] },
    description: { blurb: null, notes: null },
  });

  const creatures = new Map([
    ['goblin-warrior', make('goblin-warrior', 'Goblin Warrior', -1, ['goblin', 'humanoid'])],
    ['ogre-warrior', make('ogre-warrior', 'Ogre Warrior', 3, ['giant', 'humanoid'])],
    ['lich', make('lich', 'Lich', 12, ['undead'], 'rare')],
  ]);

  const rows = [...creatures.values()].map((c) => ({
    id: c.id, kind: 'creature', name: c.name, search: c.name.toLowerCase(),
    level: c.level, rarity: c.rarity, size: 'med', creatureType: c.creatureType,
    traits: c.traits, book: 'Test', pack: 'test', tier: 'core', remaster: true,
    supersededBy: null, complex: null,
  }));

  const real = openCatalogue({ dataDir: '/nonexistent' });
  return {
    ...real,
    available: true,
    search: ({ q = '', levelMin = null, levelMax = null, traits = [], rarity = null, limit = 50 } = {}) => {
      const matched = rows.filter((r) => {
        if (q && !r.search.includes(q.toLowerCase())) return false;
        if (levelMin !== null && r.level < levelMin) return false;
        if (levelMax !== null && r.level > levelMax) return false;
        if (rarity && r.rarity !== rarity) return false;
        for (const t of traits) if (!r.traits.includes(t)) return false;
        return true;
      });
      return { available: true, total: matched.length, rows: matched.slice(0, limit) };
    },
    get: (id) => creatures.get(id) ?? null,
    has: (id) => creatures.has(id),
    traits: () => [{ trait: 'humanoid', count: 2 }, { trait: 'undead', count: 1 }],
    sources: () => [{ book: 'Test', count: 3 }],
    stats: () => ({ available: true, creatures: 3, hazards: 0, commit: 'test' }),
  };
}
