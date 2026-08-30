/**
 * The loop console API, including the part that matters most: a loop run is
 * campaign-scoped like everything else, and running the same one-shot for two
 * groups gives two independent runs rather than one shared one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const gm = (path, options = {}) => app.inject({
  url: `/api/gm/${world.gmToken}${path}`, method: 'GET', ...options,
});

const put = (path, payload) => gm(path, { method: 'PUT', payload });

const STATE = {
  loop: 3,
  slot: 5,
  party: ['Kestrel', 'Dorn', 'Vex'],
  faults: {
    wine: { known: true, fixed: true, sticky: false },
    aspic: { known: true, fixed: true, sticky: true },
  },
  influence: { points: 6, highWater: 6, discovered: ['Society'] },
  log: { 3: { 0: { 2: 'went to the cellar' } } },
};

const ADVENTURE = 'nine-minutes-to-the-toast';

describe('a loop run', () => {
  it('is null before the GM has saved one', async () => {
    const res = await gm(`/campaigns/${world.tuesday.campaign.id}/loop/${ADVENTURE}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().run).toBeNull();
  });

  it('round-trips the whole state', async () => {
    const id = world.tuesday.campaign.id;
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: STATE, title: 'Nine Minutes' });

    const { run } = (await gm(`/campaigns/${id}/loop/${ADVENTURE}`)).json();
    expect(run.state).toEqual(STATE);
    expect(run.title).toBe('Nine Minutes');
  });

  it('keeps the spine in columns so it can be read without parsing JSON', async () => {
    const id = world.tuesday.campaign.id;
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: STATE });
    const { run } = (await gm(`/campaigns/${id}/loop/${ADVENTURE}`)).json();
    expect(run).toMatchObject({ loop: 3, slot: 5, influencePoints: 6, influenceHighWater: 6 });
  });

  it('updates in place rather than accumulating runs', async () => {
    const id = world.tuesday.campaign.id;
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: STATE });
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: { ...STATE, loop: 4 } });

    const { runs } = (await gm(`/campaigns/${id}/loop`)).json();
    expect(runs).toHaveLength(1);
    expect(runs[0].loop).toBe(4);
  });

  it('refuses an adventure id that is not one', async () => {
    const id = world.tuesday.campaign.id;
    const res = await put(`/campaigns/${id}/loop/${encodeURIComponent('../etc/passwd')}`, { state: STATE });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a save with no state', async () => {
    const id = world.tuesday.campaign.id;
    expect((await put(`/campaigns/${id}/loop/${ADVENTURE}`, {})).statusCode).toBe(400);
  });

  it('can be thrown away, and hands back what it deleted', async () => {
    const id = world.tuesday.campaign.id;
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: STATE });

    const res = await gm(`/campaigns/${id}/loop/${ADVENTURE}`, { method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted.state).toEqual(STATE);
    expect((await gm(`/campaigns/${id}/loop/${ADVENTURE}`)).json().run).toBeNull();
  });

  it('404s on deleting a run that was never saved', async () => {
    const id = world.tuesday.campaign.id;
    const res = await gm(`/campaigns/${id}/loop/${ADVENTURE}`, { method: 'DELETE' });
    expect(res.statusCode).toBe(404);
  });
});

describe('two groups running the same one-shot', () => {
  it('keep independent runs', async () => {
    const tuesday = world.tuesday.campaign.id;
    const saturday = world.saturday.campaign.id;

    await put(`/campaigns/${tuesday}/loop/${ADVENTURE}`, { state: { ...STATE, loop: 3 } });
    await put(`/campaigns/${saturday}/loop/${ADVENTURE}`, { state: { ...STATE, loop: 9 } });

    expect((await gm(`/campaigns/${tuesday}/loop/${ADVENTURE}`)).json().run.loop).toBe(3);
    expect((await gm(`/campaigns/${saturday}/loop/${ADVENTURE}`)).json().run.loop).toBe(9);
  });

  it('never list each other’s runs', async () => {
    const tuesday = world.tuesday.campaign.id;
    const saturday = world.saturday.campaign.id;
    await put(`/campaigns/${tuesday}/loop/${ADVENTURE}`, { state: STATE, title: 'Tuesday run' });

    const { runs } = (await gm(`/campaigns/${saturday}/loop`)).json();
    expect(runs).toEqual([]);
  });
});

describe('a token that is not the GM’s', () => {
  it('cannot read a loop run with a character token', async () => {
    const id = world.tuesday.campaign.id;
    const res = await app.inject({
      url: `/api/gm/${world.tuesday.characterToken}/campaigns/${id}/loop/${ADVENTURE}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('cannot write a loop run with a table token', async () => {
    const id = world.tuesday.campaign.id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.tuesday.tableToken}/campaigns/${id}/loop/${ADVENTURE}`,
      payload: { state: STATE },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not leak a run through the shared screen', async () => {
    const id = world.tuesday.campaign.id;
    await put(`/campaigns/${id}/loop/${ADVENTURE}`, { state: STATE });
    const body = (await app.inject({ url: `/api/table/${world.tuesday.tableToken}` })).json();
    expect(JSON.stringify(body)).not.toContain('went to the cellar');
  });
});
