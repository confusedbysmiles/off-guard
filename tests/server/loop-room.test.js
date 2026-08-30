/**
 * The loop, as the room may see it.
 *
 * The shared screen's rule has always been that the payload contains only what
 * players may see -- a secret roll is dropped from it rather than sent with a
 * flag, so there is nothing on the page to hide and nothing to leak. A looping
 * adventure is the hardest case that rule has faced: the adventure holds
 * discovery DCs, solutions, and the faults nobody has found yet, and a player
 * can open the shared screen on their own phone and read the source.
 *
 * So the server resolves it. These are the tests that say the resolution is
 * lossy in the right direction.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';
import { ADVENTURE } from '../../src/shared/adventures/nine-minutes.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const campaignId = () => world.tuesday.campaign.id;

const state = (overrides = {}) => ({
  loop: 3,
  slot: 7,
  party: ['PC 1', 'PC 2', 'PC 3'],
  faults: {
    wine: { known: true, fixed: true, sticky: false },
    guest: { known: true, fixed: false, sticky: false },
    aspic: { known: false, fixed: false, sticky: false },
  },
  influence: { points: 5, highWater: 6, discovered: ['Society'] },
  log: {},
  ...overrides,
});

const save = (body) => app.inject({
  method: 'PUT',
  url: `/api/gm/${world.gmToken}/campaigns/${campaignId()}/loop/${ADVENTURE.id}`,
  payload: { state: state(body), title: 'Nine Minutes to the Toast' },
});

const roomView = async () => (await app.inject({
  method: 'GET', url: `/api/table/${world.tuesday.tableToken}`,
})).json();

describe('what reaches the room', () => {
  beforeEach(async () => { await save(); });

  it('is the clock, which is the point of the screen', async () => {
    const { loop } = await roomView();
    expect(loop.clock).toEqual({ text: '7:57', suffix: 'PM' });
    expect(loop.loop).toBe(3);
    expect(loop.slot).toBe(7);
    expect(loop.slots).toBe(9);
  });

  it('names the event on this minute, without the note written to the GM', async () => {
    const { loop } = await roomView();
    expect(loop.event).toEqual({ label: 'Aspic', tone: 'amber' });
    // "Every loop, no exceptions" is a fact about how the adventure is built.
    expect(JSON.stringify(loop)).not.toContain('no exceptions');
  });

  it('lists the faults the party has worked out, and whether each is fixed', async () => {
    const { loop } = await roomView();
    expect(loop.known.map((f) => f.id)).toEqual(['wine', 'guest']);
    expect(loop.known.find((f) => f.id === 'wine').fixed).toBe(true);
    expect(loop.known.find((f) => f.id === 'guest').fixed).toBe(false);
  });
});

describe('what does not', () => {
  beforeEach(async () => { await save(); });

  it('does not mention a fault nobody has found', async () => {
    const body = JSON.stringify(await roomView());
    const hidden = ADVENTURE.faults.find((f) => f.id === 'aspic');
    expect(body).not.toContain(hidden.name);
    expect(body).not.toContain('aspic');
  });

  it('does not say how many are left to find', async () => {
    // "two of five" is a fact about the adventure, and it is the fact that
    // stops a table looking.
    const { loop } = await roomView();
    expect(loop).not.toHaveProperty('total');
    expect(loop).not.toHaveProperty('faultCount');
    expect(JSON.stringify(loop)).not.toContain(`"${ADVENTURE.faults.length}"`);
  });

  it('carries no discovery DC, route or solution from any fault', async () => {
    const body = JSON.stringify(await roomView());
    for (const fault of ADVENTURE.faults) {
      for (const line of fault.discovery ?? []) expect(body).not.toContain(line);
      for (const route of fault.routes ?? []) {
        expect(body).not.toContain(route.label);
        if (route.note) expect(body).not.toContain(route.note);
      }
      if (fault.summary) expect(body).not.toContain(fault.summary);
    }
  });

  it('carries no influence skill list, and no high-water mark', async () => {
    const { loop } = await roomView();
    expect(loop.influence).toEqual({ points: 5, max: 8 });
    const body = JSON.stringify(loop);
    for (const skill of ADVENTURE.influence.skills) expect(body).not.toContain(skill.name);
  });
});

describe('when there is no loop', () => {
  it('is null, and the screen is what it always was', async () => {
    const view = await roomView();
    expect(view.loop).toBeNull();
    expect(view).toHaveProperty('combatants');
  });

  it('is null for a run whose adventure is no longer installed', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${campaignId()}/loop/nine-minutes-to-the-toast`,
      payload: { state: state(), title: 'x' },
    });
    db.prepare('UPDATE loop_run SET adventure_id = ?').run('an-adventure-that-was-deleted');
    expect((await roomView()).loop).toBeNull();
  });
});

describe('the clock stands on its own', () => {
  it('reaches the room with no fight running', async () => {
    // A looping adventure is watched between fights as much as during them.
    await app.inject({
      method: 'POST',
      url: `/api/gm/${world.gmToken}/campaigns/${campaignId()}/combat/${world.tuesday.combat.id}/end`,
    });
    await save();
    const view = await roomView();
    expect(view.round).toBeNull();
    expect(view.combatants).toEqual([]);
    expect(view.loop.clock.text).toBe('7:57');
  });
});

describe('another campaign', () => {
  it('never sees this one’s loop', async () => {
    await save();
    const other = await app.inject({
      method: 'GET', url: `/api/table/${world.saturday.tableToken}`,
    });
    expect(other.json().loop).toBeNull();
  });
});
