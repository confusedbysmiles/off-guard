/**
 * A character as a file.
 *
 * The round trip is the whole claim: a character exported and restored is the
 * same character. Everything else here guards the edges of that -- what the
 * file must not carry, what a file from elsewhere does, and who is allowed to
 * ask for one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';
import { FORMAT, FORMAT_VERSION } from '../../src/shared/portable.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const token = () => world.tuesday.characterToken;
const get = (url) => app.inject({ method: 'GET', url });
const post = (path, payload) => app.inject({
  method: 'POST', url: `/api/c/${token()}${path}`, payload,
});

const exported = async () => (await get(`/api/c/${token()}/export`)).json();
const sheetNow = async () => (await get(`/api/c/${token()}`)).json().character.sheet;

const patch = (writes) => app.inject({
  method: 'PATCH', url: `/api/c/${token()}`, payload: { writes },
});

describe('exporting', () => {
  it('says what it is, so a reader never has to guess from the shape', async () => {
    const file = await exported();
    expect(file.format).toBe(FORMAT);
    expect(file.version).toBe(FORMAT_VERSION);
    expect(file.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('carries the sheet and the name a player would recognise', async () => {
    const file = await exported();
    expect(file.character.name).toBe('Kestrel');
    expect(file.character.sheet).toEqual(await sheetNow());
  });

  /**
   * The one mistake this feature could make that would matter. A link is a
   * credential, and this is a file players are encouraged to keep a copy of.
   */
  it('carries no token, and no id that names a row in this database', async () => {
    const text = JSON.stringify(await exported());
    expect(text).not.toContain(token());
    expect(await exported()).not.toHaveProperty('character.id');
    expect(await exported()).not.toHaveProperty('character.campaignId');
  });

  it('is not reachable from the shared screen', async () => {
    expect((await get(`/api/c/${world.tuesday.tableToken}/export`)).statusCode).toBe(404);
  });

  it('comes to the GM too, scoped to the campaign they named', async () => {
    const mine = await get(
      `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}`
      + `/characters/${world.tuesday.characters.kestrel.id}/export`,
    );
    expect(mine.statusCode).toBe(200);
    expect(mine.json().character.name).toBe('Kestrel');

    // The same character, asked for through the wrong campaign.
    const wrong = await get(
      `/api/gm/${world.gmToken}/campaigns/${world.saturday.campaign.id}`
      + `/characters/${world.tuesday.characters.kestrel.id}/export`,
    );
    expect(wrong.statusCode).toBe(404);
  });
});

describe('restoring', () => {
  it('brings a character back exactly as they were', async () => {
    await patch([
      { path: 'name', value: 'Kestrel Vane' },
      { path: 'hp', value: { max: 48, current: 31, temp: 0 } },
      { path: 'notes', value: 'owes the innkeeper' },
    ]);
    const file = await exported();

    await patch([
      { path: 'name', value: 'Somebody Else' },
      { path: 'hp', value: { max: 9, current: 9, temp: 0 } },
      { path: 'notes', value: 'wrong character' },
    ]);

    const preview = (await post('/import/preview', { json: file })).json();
    await post('/import/apply', { changes: preview.changes, build: preview.builder?.build ?? null });

    const after = await sheetNow();
    expect(after.name).toBe('Kestrel Vane');
    expect(after.hp).toEqual({ max: 48, current: 31, temp: 0 });
    expect(after.notes).toBe('owes the innkeeper');
  });

  /**
   * A restore proposes every value the file holds. It does not delete values
   * the file lacks.
   *
   * That is a deliberate limit rather than an oversight. The dialog's whole
   * model is a row per change that the player can untick, and "remove a field
   * you cannot see" is not a row anybody can judge -- so a restore is additive,
   * and a note the player wrote after the export survives one. Said here so
   * that if it ever needs to be a true replace, it is a decision rather than a
   * discovery.
   */
  it('leaves alone what the file says nothing about', async () => {
    await patch([{ path: 'name', value: 'Kestrel Vane' }]);
    const file = await exported();
    await patch([{ path: 'notes', value: 'written after the export' }]);

    const preview = (await post('/import/preview', { json: file })).json();
    await post('/import/apply', { changes: preview.changes });

    expect((await sheetNow()).notes).toBe('written after the export');
  });

  /**
   * The opposite of the Pathbuilder rule, and for the opposite reason: a
   * level-up re-import should not heal you, and a restore from a snapshot
   * should put back the character in the snapshot.
   */
  it('puts back current hit points, which a Pathbuilder import never touches', async () => {
    await patch([{ path: 'hp', value: { max: 48, current: 11, temp: 0 } }]);
    const file = await exported();
    await patch([{ path: 'hp', value: { max: 48, current: 48, temp: 0 } }]);

    const preview = (await post('/import/preview', { json: file })).json();
    expect(preview.changes.map((c) => c.path)).toContain('hp.current');

    await post('/import/apply', { changes: preview.changes });
    expect((await sheetNow()).hp.current).toBe(11);
  });

  it('says the build is exact, because nothing about it was inferred', async () => {
    const builder = (await app.inject({
      method: 'PATCH',
      url: `/api/c/${token()}/builder`,
      payload: { build: { version: 1, level: 3, ancestry: 'ancestry:dwarf', class: 'class:fighter' } },
    })).json();
    expect(builder.builder.sheet.class).toBe('Fighter');

    const preview = (await post('/import/preview', { json: await exported() })).json();
    expect(preview.builder.exact).toBe(true);
    expect(preview.builder.differences).toEqual([]);
    expect(preview.builder.summary.class).toBe('Fighter');
  });

  it('refuses a file from a newer Off-Guard rather than reading it hopefully', async () => {
    const file = { ...(await exported()), version: FORMAT_VERSION + 1 };
    const res = await post('/import/preview', { json: file });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/newer Off-Guard/);
  });

  it('refuses one of ours with no sheet in it', async () => {
    const res = await post('/import/preview', { json: { format: FORMAT, version: 1, character: {} } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no sheet/);
  });

  it('still reads a Pathbuilder file, which claims no format at all', async () => {
    const res = await post('/import/preview', { json: { success: true, build: { name: 'Elsewhere', level: 2 } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sheet.name).toBe('Elsewhere');
    expect(res.json().restore).toBeUndefined();
  });
});
