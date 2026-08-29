/**
 * The API's own behaviour: versioned sheet writes, encounter copying, and what
 * the shared screen is allowed to say.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';
import { healthDescriptor } from '../../src/server/store/combat.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const patchSheet = (token, writes) => app.inject({
  method: 'PATCH', url: `/api/c/${token}`, payload: { writes },
});

describe('versioned sheet writes', () => {
  it('applies a write and returns its new version', async () => {
    const res = await patchSheet(world.tuesday.characterToken, [
      { path: 'hp.current', value: 31 },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toEqual([{ path: 'hp.current', version: 1 }]);
    expect(body.character.sheet.hp.current).toBe(31);
  });

  it('rejects a stale write for that path alone, keeping the rest', async () => {
    await patchSheet(world.tuesday.characterToken, [{ path: 'notes', value: 'first' }]);

    const res = await patchSheet(world.tuesday.characterToken, [
      { path: 'notes', value: 'stale', baseVersion: 0 },
      { path: 'hp.current', value: 12, baseVersion: 0 },
    ]);

    const body = res.json();
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({
      path: 'notes', expectedVersion: 0, currentVersion: 1, currentValue: 'first',
    });
    // The write that was not stale still landed.
    expect(body.applied.map((a) => a.path)).toEqual(['hp.current']);
    expect(body.character.sheet.notes).toBe('first');
    expect(body.character.sheet.hp.current).toBe(12);
  });

  it('lets the GM push a condition without clobbering a note being typed', async () => {
    await patchSheet(world.tuesday.characterToken, [{ path: 'notes', value: 'mid-sentence' }]);

    const gmPush = await app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}`
        + `/characters/${world.tuesday.characters.kestrel.id}`,
      payload: { writes: [{ path: 'conditions', value: [{ slug: 'frightened', value: 2 }] }] },
    });

    const body = gmPush.json();
    expect(body.conflicts).toHaveLength(0);
    expect(body.character.sheet.notes).toBe('mid-sentence');
    expect(body.character.sheet.conditions[0].slug).toBe('frightened');
    expect(body.versions.conditions.updatedBy).toBe('gm');
    expect(body.versions.notes.updatedBy).toBe('player');
  });

  it('denormalizes name and level so the party panel need not parse every sheet', async () => {
    await patchSheet(world.tuesday.characterToken, [
      { path: 'name', value: 'Kestrel Vane' },
      { path: 'level', value: 5 },
    ]);
    const row = db.prepare('SELECT name, level FROM character WHERE id = ?')
      .get(world.tuesday.characters.kestrel.id);
    expect(row).toEqual({ name: 'Kestrel Vane', level: 5 });
  });
});

describe('copying an encounter between campaigns', () => {
  it('carries the creatures across and leaves the original alone', async () => {
    const base = `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}`;
    await app.inject({
      method: 'PUT',
      url: `${base}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: {
        creatures: [
          { creatureId: 'goblin-warrior', displayName: 'Goblin A', count: 1 },
          { creatureId: 'goblin-warrior', displayName: 'Goblin B', adjustment: 'elite' },
        ],
      },
    });

    const copied = await app.inject({
      method: 'POST',
      url: `${base}/encounters/${world.tuesday.encounter.id}/copy`,
      payload: { toCampaignId: world.saturday.campaign.id },
    });

    expect(copied.statusCode).toBe(201);
    const encounter = copied.json().encounter;
    expect(encounter.campaignId).toBe(world.saturday.campaign.id);
    expect(encounter.creatures.map((c) => c.displayName)).toEqual(['Goblin A', 'Goblin B']);
    expect(encounter.creatures[1].adjustment).toBe('elite');
    expect(encounter.id).not.toBe(world.tuesday.encounter.id);

    const original = await app.inject({
      method: 'GET', url: `${base}/encounters/${world.tuesday.encounter.id}`,
    });
    expect(original.json().encounter.creatures).toHaveLength(2);
  });
});

describe('what the shared screen says about health', () => {
  it.each([
    [48, 48, 'Unharmed'],
    [40, 48, 'Lightly Injured'],
    [30, 48, 'Moderately Injured'],
    [20, 48, 'Heavily Injured'],
    [5, 48, 'Near Death'],
    [0, 48, 'Near Death'],
  ])('%i of %i is %s', (current, max, descriptor) => {
    expect(healthDescriptor(current, max)).toBe(descriptor);
  });

  it('gives a number for a player character and a descriptor for a creature', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/table/${world.tuesday.tableToken}` });
    const body = res.json();
    const player = body.combatants.find((c) => c.name === 'Kestrel');
    const goblin = body.combatants.find((c) => c.name === 'Goblin A');
    expect(player.hpCurrent).toBe(40);
    expect(goblin).not.toHaveProperty('hpCurrent');
    expect(goblin.health).toBe('Unharmed');
  });

  it('drops a hidden combatant entirely rather than blanking it', async () => {
    db.prepare("UPDATE combatant SET visible = 0 WHERE display_name = 'Goblin A'").run();
    const body = (await app.inject({
      method: 'GET', url: `/api/table/${world.tuesday.tableToken}`,
    })).json();
    expect(body.combatants.map((c) => c.name)).toEqual(['Kestrel']);
    expect(JSON.stringify(body)).not.toContain('Goblin');
  });

  it('gives a number when the GM flips one creature to numeric', async () => {
    db.prepare("UPDATE combatant SET hp_numeric = 1 WHERE display_name = 'Goblin A'").run();
    const body = (await app.inject({
      method: 'GET', url: `/api/table/${world.tuesday.tableToken}`,
    })).json();
    const goblin = body.combatants.find((c) => c.name === 'Goblin A');
    expect(goblin.hpCurrent).toBe(6);
    expect(goblin).not.toHaveProperty('health');
  });
});

describe('the cross-campaign overview', () => {
  it('gives every campaign’s level and last activity on one call', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}/overview` });
    const campaigns = res.json().campaigns;
    expect(campaigns).toHaveLength(2);
    expect(campaigns.map((c) => c.name).sort()).toEqual([
      'Saturday: Kingmaker', 'Tuesday: Abomination Vaults',
    ]);
    const tuesday = campaigns.find((c) => c.name.startsWith('Tuesday'));
    expect(tuesday.characterCount).toBe(2);
    expect(tuesday.encounterCount).toBe(1);
    expect(tuesday.partyLevel).toBe(4);
  });
});
