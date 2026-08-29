/**
 * The reference corpus and the Recall Knowledge helper.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { freshDb, seed } from './helpers.js';
import { stubCatalogue } from './stub-catalogue.js';
import { loadReference } from '../../src/server/reference.js';

let app; let db; let world;

// The stub catalogue, so Recall Knowledge has a stat block without a 66 MB
// data build behind it. The corpus itself is checked in and always present.
beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({ db, catalogue: stubCatalogue(), logger: false });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const gm = (path) => app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}${path}` });

describe('the reference corpus', () => {
  it('is served with a citation on every table', async () => {
    const res = await gm('/reference');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    const tables = body.entries.filter((e) => e.kind === 'table');
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.every((e) => e.citation)).toBe(true);
  });

  it('carries no style attributes, which the CSP would refuse anyway', async () => {
    const body = (await gm('/reference')).json();
    expect(body.entries.some((e) => /style=/.test(e.html))).toBe(false);
  });

  it('leaves no raw Foundry markup on screen', async () => {
    const body = (await gm('/reference')).json();
    const html = body.entries.map((e) => e.html).join(' ');
    expect(html).not.toMatch(/@(Damage|Check|UUID|Template|Localize)\[/);
    expect(html).not.toMatch(/\[\[\//);
  });

  it('answers 304 when the client already has it', async () => {
    const first = await gm('/reference');
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    const second = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/reference`,
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it('is not reachable with a character or table token', async () => {
    for (const token of [world.tuesday.characterToken, world.tuesday.tableToken]) {
      const res = await app.inject({ method: 'GET', url: `/api/gm/${token}/reference` });
      expect(res.statusCode).toBe(404);
    }
  });

  it('says so rather than failing when the file is missing', () => {
    const missing = loadReference({ file: '/nonexistent/reference.json' });
    expect(missing.available).toBe(false);
    expect(JSON.parse(missing.body).entries).toEqual([]);
  });
});

describe('Recall Knowledge against a combatant', () => {
  const combatantId = () => db.prepare(
    'SELECT id FROM combatant WHERE display_name = ?',
  ).get('Goblin A').id;

  it('names the skills, the DC and the facts', async () => {
    const res = await gm(
      `/campaigns/${world.tuesday.campaign.id}/combat/combatants/${combatantId()}/recall-knowledge`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dc.dc).toBeGreaterThan(0);
    expect(body.skills.map((s) => s.skill)).toContain('lore');
    expect(body.facts.length).toBeGreaterThan(0);
    expect(body.facts.every((f) => f.revealed === false)).toBe(true);
  });

  it('marks what the GM has already revealed', async () => {
    const id = combatantId();
    const key = 'ac';
    await app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}/combat/combatants/${id}`,
      payload: { revealed: [{ key, label: 'AC', value: '16' }] },
    });
    const body = (await gm(
      `/campaigns/${world.tuesday.campaign.id}/combat/combatants/${id}/recall-knowledge`,
    )).json();
    expect(body.facts.find((f) => f.key === key)?.revealed).toBe(true);
  });

  it('a revealed fact reaches the shared screen', async () => {
    const id = combatantId();
    await app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}/combat/combatants/${id}`,
      payload: { visible: true, revealed: [{ key: 'ac', label: 'AC', value: '16' }] },
    });
    const view = (await app.inject({
      method: 'GET', url: `/api/table/${world.tuesday.tableToken}`,
    })).json();
    const goblin = view.combatants.find((c) => c.name === 'Goblin A');
    expect(goblin.revealed).toEqual([{ key: 'ac', label: 'AC', value: '16' }]);
  });

  it('refuses a combatant in another campaign', async () => {
    const res = await gm(
      `/campaigns/${world.saturday.campaign.id}/combat/combatants/${combatantId()}/recall-knowledge`,
    );
    expect(res.statusCode).toBe(404);
  });
});
