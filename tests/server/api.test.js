/**
 * The API's own behaviour: versioned sheet writes, encounter copying, and what
 * the shared screen is allowed to say.
 */
import { readFileSync } from 'node:fs';

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

describe('the Pathbuilder import endpoints', () => {
  const build = {
    build: {
      name: 'Kestrel Vane', class: 'Fighter', level: 6, ancestry: 'Human',
      keyability: 'str',
      abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      attributes: { ancestryhp: 8, classhp: 10, bonushp: 0, bonushpPerLevel: 0, speed: 25 },
      proficiencies: { perception: 6, fortitude: 6, reflex: 4, will: 4, athletics: 6 },
      weapons: [], lores: [], spellCasters: [],
    },
  };

  const post = (token, path, payload) => app.inject({
    method: 'POST', url: `/api/c/${token}${path}`, payload,
  });

  it('previews without writing anything', async () => {
    const res = await post(world.tuesday.characterToken, '/import/preview', { json: build });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changes.some((c) => c.path === 'name' && c.to === 'Kestrel Vane')).toBe(true);

    const stored = db.prepare('SELECT sheet FROM character WHERE id = ?')
      .get(world.tuesday.characters.kestrel.id);
    expect(JSON.parse(stored.sheet)).toEqual({});
  });

  it('applies only the changes it is given', async () => {
    const preview = (await post(world.tuesday.characterToken, '/import/preview', { json: build })).json();
    const chosen = preview.changes.filter((c) => c.path === 'name' || c.path === 'level');

    const applied = await post(world.tuesday.characterToken, '/import/apply', { changes: chosen });
    expect(applied.statusCode).toBe(200);

    const sheet = applied.json().character.sheet;
    expect(sheet.name).toBe('Kestrel Vane');
    expect(sheet.level).toBe(6);
    // Everything unchecked stayed out.
    expect(sheet.ancestry).toBeUndefined();
    expect(sheet.skills).toBeUndefined();
  });

  it('does not overwrite what the player typed by hand', async () => {
    await patchSheet(world.tuesday.characterToken, [
      { path: 'notes', value: 'Owes the innkeeper 4 gp' },
      { path: 'feats', value: 'Power Attack' },
    ]);

    const preview = (await post(world.tuesday.characterToken, '/import/preview', { json: build })).json();
    expect(preview.changes.map((c) => c.path)).not.toContain('notes');
    expect(preview.changes.map((c) => c.path)).not.toContain('feats');

    await post(world.tuesday.characterToken, '/import/apply', { changes: preview.changes });
    const sheet = (await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}`,
    })).json().character.sheet;
    expect(sheet.notes).toBe('Owes the innkeeper 4 gp');
    expect(sheet.feats).toBe('Power Attack');
    expect(sheet.name).toBe('Kestrel Vane');
  });

  it('marks an import as an import in the field history', async () => {
    const preview = (await post(world.tuesday.characterToken, '/import/preview', { json: build })).json();
    const result = await post(world.tuesday.characterToken, '/import/apply', { changes: preview.changes });
    expect(result.json().versions.name.updatedBy).toBe('import');
  });

  it('refuses a request with neither a file nor a build id', async () => {
    const res = await post(world.tuesday.characterToken, '/import/preview', {});
    expect(res.statusCode).toBe(400);
  });

  it('treats an empty build id box as nothing given, not as a bad id', async () => {
    const res = await post(world.tuesday.characterToken, '/import/preview', { buildId: '  ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/build id or upload/);
  });

  /**
   * The failure the live journal caught: a build id that was not a number threw
   * a 502, and the error handler replaces the body of anything 500 or over with
   * "Something went wrong". The dialog prints `error`, so a typo said nothing
   * at all about what to do next.
   */
  it('tells the player what is wrong with the build id they typed', async () => {
    const res = await post(world.tuesday.characterToken, '/import/preview', { buildId: 'my character' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/number from its export screen/);
    expect(res.json().error).not.toBe('Something went wrong');
  });

  it('says what the import can actually do on this server', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}/import/capabilities`,
    });
    const body = res.json();
    expect(body.fileUpload).toBe(true);
    expect(typeof body.buildIdNote).toBe('string');
  });

  it('is not reachable from a table token', async () => {
    const res = await post(world.tuesday.tableToken, '/import/preview', { json: build });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * An imported character, meeting the builder.
 *
 * The two halves of the application disagreed about who owned a sheet. The
 * import writes fields and no build; the builder derived a blank build and
 * wrote its zeroes over them. Opening the builder and clicking once cost a
 * Pathbuilder import its class, its hit points, its money and its entire bag,
 * with no warning and nothing to undo it with.
 */
describe('an import, and then the builder', () => {
  const real = JSON.parse(readFileSync(
    new URL('../fixtures/pathbuilder/rogue-6.json', import.meta.url), 'utf8',
  ));

  const post = (tok, path, payload) => app.inject({
    method: 'POST', url: `/api/c/${tok}${path}`, payload,
  });

  const token = () => world.tuesday.characterToken;
  const sheetNow = async () => (await app.inject({
    method: 'GET', url: `/api/c/${token()}`,
  })).json().character.sheet;

  const importAll = async () => {
    const preview = (await post(token(), '/import/preview', { json: real })).json();
    await post(token(), '/import/apply', { changes: preview.changes });
  };

  const builder = async () => (await app.inject({
    method: 'GET', url: `/api/c/${token()}/builder`,
  })).json();

  const saveBuild = (build) => app.inject({
    method: 'PATCH', url: `/api/c/${token()}/builder`, payload: { build },
  });

  it('survives opening the builder and choosing one thing', async () => {
    await importAll();
    const before = await sheetNow();
    expect(before.coins.gp).toBe(187);
    expect(before.gear.length).toBeGreaterThan(20);

    const state = await builder();
    await saveBuild({ ...state.build, ancestry: 'ancestry:goblin' });

    const after = await sheetNow();
    expect(after.class).toBe(before.class);
    expect(after.level).toBe(before.level);
    expect(after.hp.max).toBe(before.hp.max);
    expect(after.coins.gp).toBe(187);
    expect(after.gear.length).toBe(before.gear.length);
  });

  it('opens the builder at the character’s own level, not at 1', async () => {
    await importAll();
    const state = await builder();
    expect(state.build.level).toBe((await sheetNow()).level);
    expect(state.build.level).toBeGreaterThan(1);
  });

  it('hands a field over once the build actually determines it', async () => {
    await importAll();
    const state = await builder();
    // A class is chosen, so the class's numbers become the builder's to set.
    await saveBuild({ ...state.build, class: 'class:fighter' });

    const after = await sheetNow();
    expect(after.class).toBe('Fighter');
    // And the things no part of the build speaks to are still the player's.
    expect(after.coins.gp).toBe(187);
  });
});

/**
 * The build an import reconstructs, against the real catalogue.
 *
 * The unit tests check the arithmetic with hand-made records. This checks the
 * claim the whole feature rests on: that a real Pathbuilder export, read
 * backwards into choices and then derived forwards again, comes out as the
 * same character. Zero differences is the requirement, not "close".
 */
describe('reconstructing a build from a real export', () => {
  const real = JSON.parse(readFileSync(
    new URL('../fixtures/pathbuilder/rogue-6.json', import.meta.url), 'utf8',
  ));
  const post = (path, payload) => app.inject({
    method: 'POST', url: `/api/c/${world.tuesday.characterToken}${path}`, payload,
  });

  it('derives the same character it was given', async () => {
    const preview = (await post('/import/preview', { json: real })).json();
    expect(preview.builder.differences).toEqual([]);
    expect(preview.builder.notes).toEqual([]);
  });

  it('resolves every name in the file to a catalogue option', async () => {
    const { builder } = (await post('/import/preview', { json: real })).json();
    expect(builder.summary).toMatchObject({
      level: 6, ancestry: 'Goblin', heritage: 'Aiuvarin',
      background: 'Codebreaker', class: 'Rogue',
    });
    expect(builder.build.ancestry).toBe('ancestry:goblin');
    expect(builder.build.class).toBe('class:rogue');
  });

  it('leaves the builder holding a character who can be levelled up', async () => {
    const preview = (await post('/import/preview', { json: real })).json();
    await post('/import/apply', { changes: preview.changes, build: preview.builder.build });

    const state = (await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}/builder`,
    })).json();
    expect(state.build.class).toBe('class:rogue');
    expect(state.missing).toEqual([]);
    expect(state.sheet.class).toBe('Rogue');
    // The things the file carried that no build choice produces are still there.
    expect(state.sheet.coins.gp).toBe(187);
  });

  it('offers the file’s own values as the alternative, with no build', async () => {
    const preview = (await post('/import/preview', { json: real })).json();
    await post('/import/apply', { changes: preview.withoutBuild, build: null });

    const state = (await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}/builder`,
    })).json();
    expect(state.build.class).toBe(null);
    const sheet = (await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}`,
    })).json().character.sheet;
    expect(sheet.class).toBe('Rogue');
  });
});
