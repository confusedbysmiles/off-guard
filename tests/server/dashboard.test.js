/**
 * The GM dashboard's data: creature search, party statistics and the encounter
 * budget read from the sheets rather than from a counter kept in sync by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { openCatalogue } from '../../src/server/catalogue.js';
import { partyFor } from '../../src/server/party.js';
import { resolveScope } from '../../src/server/scope.js';
import { applyPatch } from '../../src/server/store/characters.js';
import { freshDb, seed } from './helpers.js';

/**
 * A catalogue of three creatures, built by hand.
 *
 * The real one needs `npm run build:data`; the dashboard's behaviour does not
 * depend on which creatures exist, and a test that needs a 66 MB build is a
 * test nobody runs.
 */
function stubCatalogue() {
  const make = (id, name, level, traits = [], rarity = 'common') => ({
    id, name, level, rarity, traits, creatureType: traits[0] ?? null,
    size: { code: 'med', label: 'Medium' },
    source: { book: 'Test', pack: 'test', license: 'ORC', remaster: true, page: null, tier: 'core' },
    perception: { mod: level + 5, senses: [], sensesLabel: null, details: null },
    languages: { value: [], details: null },
    skills: [], abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
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

let app; let db; let world;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({ db, catalogue: stubCatalogue(), logger: false });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const gm = (path) => app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}${path}` });
const tuesday = () => world.tuesday.campaign.id;

describe('creature search', () => {
  it('finds by name', async () => {
    const body = (await gm('/catalogue/search?q=ogre')).json();
    expect(body.total).toBe(1);
    expect(body.rows[0].name).toBe('Ogre Warrior');
  });

  it('filters by level range', async () => {
    const body = (await gm('/catalogue/search?levelMin=0&levelMax=5')).json();
    expect(body.rows.map((r) => r.name)).toEqual(['Ogre Warrior']);
  });

  it('requires every requested trait, not any of them', async () => {
    const both = (await gm('/catalogue/search?traits=giant,humanoid')).json();
    expect(both.total).toBe(1);
    const neither = (await gm('/catalogue/search?traits=giant,undead')).json();
    expect(neither.total).toBe(0);
  });

  it('filters by rarity', async () => {
    const body = (await gm('/catalogue/search?rarity=rare')).json();
    expect(body.rows.map((r) => r.name)).toEqual(['Lich']);
  });

  it('is not reachable from a player link', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/gm/${world.tuesday.characterToken}/catalogue/search?q=ogre`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('a stat block with adjustments applied', () => {
  it('returns the base creature untouched by default', async () => {
    const { creature } = (await gm('/catalogue/goblin-warrior')).json();
    expect(creature.level).toBe(-1);
    expect(creature.ac.value).toBe(14);
    expect(creature.adjustment ?? null).toBeNull();
  });

  it('applies elite', async () => {
    const { creature } = (await gm('/catalogue/goblin-warrior?adjustment=elite')).json();
    // Level -1 elite goes up by two, and takes the +10 hit point band.
    expect(creature.level).toBe(1);
    expect(creature.ac.value).toBe(16);
    expect(creature.hp.max).toBe(20);
    expect(creature.adjustment.kind).toBe('elite');
  });

  it('applies scaling and elite together, in that order', async () => {
    const { creature } = (await gm('/catalogue/ogre-warrior?scale=2&adjustment=elite')).json();
    // Scaled 3 -> 5, then elite -> 6. The hit point band is read from 5, which
    // is the 5-19 band's +20, not the 2-4 band's +15.
    expect(creature.level).toBe(6);
    expect(creature.scaling.targetLevel).toBe(5);
    expect(creature.adjustment.startingLevel).toBe(5);
    expect(creature.adjustment.hpDelta).toBe(20);
  });

  it('404s for a creature that is not in the catalogue', async () => {
    expect((await gm('/catalogue/nonexistent')).statusCode).toBe(404);
  });
});

describe('the party panel', () => {
  it('computes every statistic from the sheets', async () => {
    const scope = resolveScope(db, world.gmToken);
    applyPatch(db, scope, world.tuesday.characters.kestrel.id, [
      { path: 'level', value: 5 },
      { path: 'abilities', value: { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 } },
      { path: 'ac', value: { rank: 'expert', itemBonus: 6, dexCap: 1 } },
      { path: 'perception', value: { rank: 'master' } },
      { path: 'saves', value: { fortitude: { rank: 'master' }, reflex: { rank: 'expert' }, will: { rank: 'expert' } } },
      { path: 'skills', value: { athletics: { rank: 'expert' } } },
      { path: 'hp', value: { max: 73, current: 58 } },
    ], { by: 'gm', campaignId: tuesday() });

    const body = (await gm(`/campaigns/${tuesday()}/party`)).json();
    const kestrel = body.characters.find((c) => c.name === 'Kestrel');

    expect(kestrel.ac).toBe(26);          // 10 + 1 capped dex + 9 expert + 6 item
    expect(kestrel.perception).toBe(12);  // 1 wis + 11 master
    expect(kestrel.saves.fortitude).toBe(14);
    expect(kestrel.skills.athletics).toBe(13);
    expect(kestrel.hp).toEqual({ current: 58, max: 73, temp: 0 });
  });

  it('flags a sheet whose level trails the party', async () => {
    const body = (await gm(`/campaigns/${tuesday()}/party`)).json();
    const behind = body.characters.filter((c) => c.flags.some((f) => f.kind === 'behind'));
    // Both Tuesday characters are level 4, matching the campaign, so none.
    expect(behind).toHaveLength(0);

    const scope = resolveScope(db, world.gmToken);
    applyPatch(db, scope, world.tuesday.characters.other.id, [{ path: 'level', value: 2 }],
      { by: 'gm', campaignId: tuesday() });

    const after = (await gm(`/campaigns/${tuesday()}/party`)).json();
    const dorn = after.characters.find((c) => c.name === 'Dorn');
    expect(dorn.flags.map((f) => f.kind)).toContain('behind');
  });

  it('flags a sheet nobody has touched in weeks', async () => {
    db.prepare("UPDATE character SET updated_at = datetime('now', '-40 days') WHERE id = ?")
      .run(world.tuesday.characters.kestrel.id);
    const body = (await gm(`/campaigns/${tuesday()}/party`)).json();
    const kestrel = body.characters.find((c) => c.name === 'Kestrel');
    expect(kestrel.flags.map((f) => f.kind)).toContain('stale');
  });

  it('reports the level the party is actually playing at', async () => {
    const scope = resolveScope(db, world.gmToken);
    applyPatch(db, scope, world.tuesday.characters.kestrel.id, [{ path: 'level', value: 6 }],
      { by: 'gm', campaignId: tuesday() });
    applyPatch(db, scope, world.tuesday.characters.other.id, [{ path: 'level', value: 6 }],
      { by: 'gm', campaignId: tuesday() });

    const party = partyFor(db, scope, tuesday());
    expect(party.campaign.partyLevel).toBe(4);
    expect(party.effectiveLevel).toBe(6);
    expect(party.levelDisagrees).toBe(true);
  });

  it('is scoped: a table token cannot read another campaign’s party', async () => {
    const scope = resolveScope(db, world.tuesday.tableToken);
    expect(() => partyFor(db, scope, world.saturday.campaign.id)).toThrow(/does not reach/);
  });
});

describe('the encounter budget', () => {
  const price = (creatures, extra = {}) => app.inject({
    method: 'POST',
    url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/price`,
    payload: { creatures, ...extra },
  });

  it('reads party size and level from the sheets', async () => {
    // Two level 4 characters in Tuesday, so a party of two at level 4.
    const body = (await price([{ creatureId: 'ogre-warrior', count: 1 }])).json();
    expect(body.party).toEqual({ size: 2, effectiveLevel: 4 });
    // A level 3 creature is -1 against a level 4 party: 30 XP.
    expect(body.totalXp).toBe(30);
  });

  it('prices against the adjusted level, not the printed one', async () => {
    const base = (await price([{ creatureId: 'ogre-warrior' }])).json();
    const elite = (await price([{ creatureId: 'ogre-warrior', adjustment: 'elite' }])).json();
    expect(base.lines[0].level).toBe(3);
    expect(elite.lines[0].level).toBe(4);
    expect(base.totalXp).toBe(30);
    expect(elite.totalXp).toBe(40);
  });

  it('prices against a scaled level too', async () => {
    const scaled = (await price([{ creatureId: 'goblin-warrior', levelScale: 4 }])).json();
    expect(scaled.lines[0].level).toBe(3);
    expect(scaled.lines[0].baseLevel).toBe(-1);
  });

  it('refuses to report a difficulty when a creature is off the table', async () => {
    const body = (await price([{ creatureId: 'lich' }])).json();
    expect(body.complete).toBe(false);
    expect(body.difficulty).toBeNull();
    expect(body.offTable[0].reason).toMatch(/beyond the encounter table/);
  });

  it('reports a creature the catalogue does not have, rather than dropping it', async () => {
    const body = (await price([{ creatureId: 'not-a-creature' }])).json();
    expect(body.missing).toHaveLength(1);
    expect(body.missing[0].creatureId).toBe('not-a-creature');
  });

  it('honours a one-shot override', async () => {
    const body = (await price([{ creatureId: 'ogre-warrior' }], { partyLevel: 3, partySize: 5 })).json();
    expect(body.lines[0].levelDifference).toBe(0);
    expect(body.totalXp).toBe(40);
    expect(body.budgets.find((b) => b.difficulty === 'moderate').xp).toBe(100);
  });

  it('prices a saved encounter from its stored rows', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: {
        creatures: [
          { creatureId: 'ogre-warrior', displayName: 'Ogre A', count: 2 },
          { creatureId: 'goblin-warrior', displayName: 'Goblin A', adjustment: 'elite' },
        ],
      },
    });
    const body = (await gm(`/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/budget`)).json();
    // Two ogres at -1 (30 each) plus an elite goblin at level 1, which is -3: 15.
    expect(body.totalXp).toBe(75);
    expect(body.lines.map((l) => l.name)).toEqual(['Ogre A', 'Goblin A']);
  });
});

describe('copying an encounter to another table', () => {
  it('says whether the difficulty band moves', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: { creatures: [{ creatureId: 'ogre-warrior', count: 3 }] },
    });

    const body = (await gm(
      `/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}`
      + `/reprice?toCampaignId=${world.saturday.campaign.id}`,
    )).json();

    expect(body.fromCampaign.id).toBe(tuesday());
    expect(body.toCampaign.id).toBe(world.saturday.campaign.id);
    expect(typeof body.bandChanged).toBe('boolean');
    expect(body.before.totalXp).not.toBe(body.after.totalXp);
  });
});

describe('a clone with no catalogue built', () => {
  it('starts, and says why search is empty', async () => {
    const empty = openCatalogue({ dataDir: '/nonexistent' });
    expect(empty.available).toBe(false);
    expect(empty.reason).toMatch(/npm run build:data/);
    expect(empty.search({ q: 'goblin' })).toEqual({ rows: [], total: 0, available: false });
    expect(empty.get('goblin-warrior')).toBeNull();
  });
});
