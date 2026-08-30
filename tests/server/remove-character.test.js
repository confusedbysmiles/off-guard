/**
 * Removing a character.
 *
 * The interesting part is not the row going away. It is the two things that
 * pointed at it: a link, and a place in a running fight.
 *
 * `token.character_id` carries no foreign key — the column was added before the
 * character table existed and never got one — so nothing in the schema stops a
 * live token from outliving the character it names. A token like that still
 * authenticates. Revoking is the application's job, and this is the test that
 * says so.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const gm = (method, url) => app.inject({ method, url: `/api/gm/${world.gmToken}${url}` });

const removeKestrel = () => gm(
  'DELETE',
  `/campaigns/${world.tuesday.campaign.id}/characters/${world.tuesday.characters.kestrel.id}`,
);

describe('what it takes with it', () => {
  it('revokes the character’s link, which nothing in the schema would', async () => {
    const before = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}` });
    expect(before.statusCode).toBe(200);

    const res = await removeKestrel();
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedLinks).toBe(1);

    const after = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}` });
    expect(after.statusCode).toBe(404);
  });

  it('takes them out of the fight rather than leaving a nameless row', async () => {
    // `combatant.character_id` is ON DELETE SET NULL, so without this the row
    // stays in the initiative order with nobody in it.
    const before = db.prepare('SELECT count(*) AS n FROM combatant WHERE character_id = ?')
      .get(world.tuesday.characters.kestrel.id).n;
    expect(before).toBeGreaterThan(0);

    expect((await removeKestrel()).json().removedFrom).toBe(before);
    expect(db.prepare('SELECT count(*) AS n FROM combatant WHERE character_id = ?')
      .get(world.tuesday.characters.kestrel.id).n).toBe(0);
  });

  it('takes the sheet’s field versions with it, by cascade', async () => {
    await removeKestrel();
    expect(db.prepare('SELECT count(*) AS n FROM character_field WHERE character_id = ?')
      .get(world.tuesday.characters.kestrel.id).n).toBe(0);
  });

  it('hands back the whole record, so the dashboard can offer an undo', async () => {
    const body = (await removeKestrel()).json();
    expect(body.character.name).toBe('Kestrel');
    expect(body.character.playerName).toBe('Alex');
    expect(body.character).toHaveProperty('sheet');
  });
});

describe('who may do it', () => {
  it('is not the player, on their own character', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/c/${world.tuesday.characterToken}`,
    });
    expect(res.statusCode).toBe(404);
    // And they are still there.
    expect((await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}`,
    })).statusCode).toBe(200);
  });

  it('is not a GM reaching into another campaign', async () => {
    const res = await gm(
      'DELETE',
      `/campaigns/${world.saturday.campaign.id}/characters/${world.tuesday.characters.kestrel.id}`,
    );
    expect(res.statusCode).toBe(404);
    expect(db.prepare('SELECT count(*) AS n FROM character WHERE id = ?')
      .get(world.tuesday.characters.kestrel.id).n).toBe(1);
  });

  it('is a 404 for a character that is already gone', async () => {
    expect((await removeKestrel()).statusCode).toBe(200);
    expect((await removeKestrel()).statusCode).toBe(404);
  });
});
