/**
 * Campaign isolation.
 *
 * The premise of the access model: a token scoped to one campaign cannot reach
 * another's data, and cannot be talked into it by sending a different campaign
 * id. Every route that takes a campaign id is exercised from the wrong side.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const get = (url) => app.inject({ method: 'GET', url });

describe('a character token', () => {
  it('reads its own sheet', async () => {
    const res = await get(`/api/c/${world.tuesday.characterToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().character.name).toBe('Kestrel');
  });

  it('sees only its own campaign’s name, not the roster', async () => {
    const body = (await get(`/api/c/${world.tuesday.characterToken}`)).json();
    expect(body.campaign.id).toBe(world.tuesday.campaign.id);
    expect(body).not.toHaveProperty('characters');
  });

  it('cannot reach a GM route', async () => {
    const res = await get(`/api/gm/${world.tuesday.characterToken}/campaigns`);
    expect(res.statusCode).toBe(404);
  });

  it('cannot be used as a table token', async () => {
    const res = await get(`/api/table/${world.tuesday.characterToken}`);
    expect(res.statusCode).toBe(404);
  });

  it('cannot read the other campaign’s shared screen', async () => {
    const res = await get(`/api/table/${world.tuesday.characterToken}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('a table token', () => {
  it('reads its own campaign’s initiative', async () => {
    const res = await get(`/api/table/${world.tuesday.tableToken}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaign.id).toBe(world.tuesday.campaign.id);
    expect(body.combatants.map((c) => c.name)).toContain('Kestrel');
  });

  it('never shows the other campaign’s fight', async () => {
    const tuesday = (await get(`/api/table/${world.tuesday.tableToken}`)).json();
    const saturday = (await get(`/api/table/${world.saturday.tableToken}`)).json();
    expect(tuesday.combatants.map((c) => c.name)).not.toContain('Troll A');
    expect(saturday.combatants.map((c) => c.name)).not.toContain('Goblin A');
    expect(saturday.combatants.map((c) => c.name)).not.toContain('Kestrel');
  });

  it('cannot reach a character sheet', async () => {
    expect((await get(`/api/c/${world.tuesday.tableToken}`)).statusCode).toBe(404);
  });

  it('cannot write anything', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/c/${world.tuesday.tableToken}`,
      payload: { writes: [{ path: 'notes', value: 'x' }] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('a forged campaign id', () => {
  const forge = (token, campaignId, suffix = '') =>
    get(`/api/gm/${token}/campaigns/${campaignId}${suffix}`);

  it('is refused when a character token names another campaign', async () => {
    // The character routes take no campaign id at all, so the attack has to go
    // through a GM route -- which refuses the token kind first.
    const res = await forge(world.tuesday.characterToken, world.saturday.campaign.id);
    expect(res.statusCode).toBe(404);
  });

  it('is refused at the store layer, not only at the route', async () => {
    const { getCampaign } = await import('../../src/server/store/campaigns.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const scope = resolveScope(db, world.tuesday.characterToken);
    expect(() => getCampaign(db, scope, world.saturday.campaign.id)).toThrow(/does not reach/);
  });

  it('refuses a forged campaign id on characters', async () => {
    const { listCharacters } = await import('../../src/server/store/characters.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const scope = resolveScope(db, world.tuesday.tableToken);
    expect(() => listCharacters(db, scope, world.saturday.campaign.id)).toThrow(/does not reach/);
    // And the honest path still works. Ordering is by sort_order then name.
    expect(listCharacters(db, scope).map((c) => c.name)).toEqual(['Dorn', 'Kestrel']);
  });

  it('refuses a forged campaign id on encounters', async () => {
    const { listEncounters } = await import('../../src/server/store/encounters.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const scope = resolveScope(db, world.tuesday.tableToken);
    expect(() => listEncounters(db, scope, world.saturday.campaign.id)).toThrow(/does not reach/);
  });

  it('refuses a forged campaign id on initiative state', async () => {
    const { getActiveCombat } = await import('../../src/server/store/combat.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const scope = resolveScope(db, world.tuesday.tableToken);
    expect(() => getActiveCombat(db, scope, world.saturday.campaign.id)).toThrow(/does not reach/);
  });
});

describe('a correct id for the wrong campaign', () => {
  it('cannot fetch a character by id across campaigns', async () => {
    const res = await get(
      `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}`
      + `/characters/${world.saturday.characters.brambles.id}`,
    );
    // The GM may reach both campaigns, but not by naming the wrong one: the
    // campaign filter is in the SQL, so this is a 404, not someone else's sheet.
    expect(res.statusCode).toBe(404);
  });

  it('cannot fetch an encounter by id across campaigns', async () => {
    const res = await get(
      `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}`
      + `/encounters/${world.saturday.encounter.id}`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('cannot write combatants into another campaign’s fight', async () => {
    const { assertCombatInScope } = await import('../../src/server/store/combat.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const gm = resolveScope(db, world.gmToken);
    expect(() => assertCombatInScope(
      db, gm, world.saturday.combat.id, world.tuesday.campaign.id,
    )).toThrow(/No such combat/);
  });
});

describe('the GM token', () => {
  it('reaches every campaign', async () => {
    const res = await get(`/api/gm/${world.gmToken}/campaigns`);
    expect(res.statusCode).toBe(200);
    expect(res.json().campaigns).toHaveLength(2);
  });

  it('must still name a campaign rather than getting a default', async () => {
    const { getCampaign } = await import('../../src/server/store/campaigns.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    const gm = resolveScope(db, world.gmToken);
    expect(() => getCampaign(db, gm, null)).toThrow(/must name a campaign/);
  });

  it('is the only scope that sees the cross-campaign overview', async () => {
    const { campaignOverview } = await import('../../src/server/store/campaigns.js');
    const { resolveScope } = await import('../../src/server/scope.js');
    expect(campaignOverview(db, resolveScope(db, world.gmToken))).toHaveLength(2);
    expect(() => campaignOverview(db, resolveScope(db, world.tuesday.characterToken)))
      .toThrow(/Only the GM/);
  });
});
