/**
 * Live updates.
 *
 * Two clients: one holding the shared screen's stream open, one making GM
 * changes. The requirement is that the second reaches the first, and that it
 * reaches nobody it should not.
 *
 * Run against a real HTTP server rather than `app.inject`, because the whole
 * point is a response that stays open, and inject resolves when a response
 * finishes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { createEventBus } from '../../src/server/events.js';
import { freshDb, seed } from './helpers.js';
import { stubCatalogue } from './stub-catalogue.js';

let app; let db; let world; let origin;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({
    db, catalogue: stubCatalogue(), bus: createEventBus({ heartbeatMs: 0 }), logger: false,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${app.server.address().port}`;
});

afterEach(async () => { await app.close(); db.close(); });

/**
 * A minimal SSE reader.
 *
 * Parses only what the server actually sends -- `id`, `event`, `data` and
 * comment lines -- so a change to the wire format shows up here rather than
 * being silently tolerated.
 */
function openStream(url) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  let comments = 0;

  const ready = fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`stream said ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            if (chunk.startsWith(':')) { comments += 1; continue; }
            const event = {};
            for (const line of chunk.split('\n')) {
              const [field, ...rest] = line.split(':');
              const value = rest.join(':').trimStart();
              if (field === 'data') event.data = JSON.parse(value);
              else if (field) event[field] = value;
            }
            if (event.event) {
              events.push(event);
              waiters.splice(0).forEach((resolve) => resolve());
            }
          }
        }
      } catch { /* aborted */ }
    })();

    return response;
  });

  return {
    ready,
    events,
    get comments() { return comments; },
    /** Wait until `count` events have arrived, or fail loudly. */
    async waitFor(count, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (events.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`only ${events.length} of ${count} events arrived`);
        }
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
      return events;
    },
    close: () => controller.abort(),
  };
}

const gmPost = (path, body = {}) => fetch(`${origin}/api/gm/${world.gmToken}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json());

const tuesday = () => world.tuesday.campaign.id;

describe('the shared screen’s stream', () => {
  it('opens with the current state rather than a blank screen', async () => {
    const stream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    await stream.ready;
    const [first] = await stream.waitFor(1);

    expect(first.event).toBe('snapshot');
    expect(first.data.campaign.id).toBe(tuesday());
    expect(first.data.combatants.map((c) => c.name)).toContain('Kestrel');
    stream.close();
  });

  it('delivers a GM hit point change to a watching screen', async () => {
    const stream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    await stream.ready;
    await stream.waitFor(1);

    const kestrel = (await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${tuesday()}/combat`,
    ).then((r) => r.json())).combat.combatants.find((c) => c.displayName === 'Kestrel');

    await gmPost(`/campaigns/${tuesday()}/combat/combatants/${kestrel.id}/damage`, { amount: 12 });

    const events = await stream.waitFor(2);
    const update = events[1];
    expect(update.event).toBe('table');
    const seen = update.data.combatants.find((c) => c.name === 'Kestrel');
    expect(seen.hpCurrent).toBe(28);
    stream.close();
  });

  it('delivers a turn change, so the screen follows the fight', async () => {
    const stream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    await stream.ready;
    await stream.waitFor(1);

    const combat = (await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${tuesday()}/combat`,
    ).then((r) => r.json())).combat;

    await gmPost(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 });

    const events = await stream.waitFor(2);
    expect(events[1].data.round).toBe(1);
    // The active id moved, which is what the screen animates.
    expect(events[1].data.activeId).not.toBe(events[0].data.activeId);
    stream.close();
  });

  it('never delivers another campaign’s fight', async () => {
    const tuesdayStream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    const saturdayStream = openStream(`${origin}/api/table/${world.saturday.tableToken}/stream`);
    await Promise.all([tuesdayStream.ready, saturdayStream.ready]);
    await Promise.all([tuesdayStream.waitFor(1), saturdayStream.waitFor(1)]);

    const troll = (await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${world.saturday.campaign.id}/combat`,
    ).then((r) => r.json())).combat.combatants[0];

    await gmPost(
      `/campaigns/${world.saturday.campaign.id}/combat/combatants/${troll.id}/damage`,
      { amount: 10 },
    );

    await saturdayStream.waitFor(2);
    // Give Tuesday every chance to receive something it should not.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(tuesdayStream.events).toHaveLength(1);
    expect(JSON.stringify(tuesdayStream.events)).not.toContain('Troll');

    tuesdayStream.close();
    saturdayStream.close();
  });

  it('is refused to a token that is not a table link', async () => {
    for (const token of [world.gmToken, world.tuesday.characterToken]) {
      const res = await fetch(`${origin}/api/table/${token}/stream`);
      expect(res.status).toBe(404);
      await res.text();
    }
  });

  it('hides a hidden combatant from the stream as well as from the page', async () => {
    const combat = (await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${tuesday()}/combat`,
    ).then((r) => r.json())).combat;
    const goblin = combat.combatants.find((c) => c.displayName === 'Goblin A');

    const stream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    await stream.ready;
    const [first] = await stream.waitFor(1);
    expect(first.data.combatants.map((c) => c.name)).toContain('Goblin A');

    await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${tuesday()}/combat/combatants/${goblin.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visible: false }),
      },
    ).then((r) => r.json());

    const events = await stream.waitFor(2);
    expect(events[1].data.combatants.map((c) => c.name)).not.toContain('Goblin A');
    // And nothing in the payload hints that a row was removed.
    expect(JSON.stringify(events[1].data)).not.toContain('Goblin');
    stream.close();
  });
});

describe('a player’s sheet stream', () => {
  it('receives a condition the GM pushed', async () => {
    const stream = openStream(`${origin}/api/c/${world.tuesday.characterToken}/stream`);
    await stream.ready;
    await stream.waitFor(1);

    await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${tuesday()}`
      + `/characters/${world.tuesday.characters.kestrel.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ writes: [{ path: 'conditions', value: [{ slug: 'frightened', value: 2 }] }] }),
      },
    ).then((r) => r.json());

    const events = await stream.waitFor(2);
    expect(events[1].event).toBe('character');
    expect(events[1].data.character.sheet.conditions[0].slug).toBe('frightened');
    stream.close();
  });

  it('does not receive another character’s changes', async () => {
    const stream = openStream(`${origin}/api/c/${world.tuesday.characterToken}/stream`);
    await stream.ready;
    await stream.waitFor(1);

    await fetch(
      `${origin}/api/gm/${world.gmToken}/campaigns/${world.saturday.campaign.id}`
      + `/characters/${world.saturday.characters.brambles.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ writes: [{ path: 'notes', value: 'elsewhere' }] }),
      },
    ).then((r) => r.json());

    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(stream.events).toHaveLength(1);
    stream.close();
  });
});

describe('the connection itself', () => {
  it('tells the client how long to wait before reconnecting', async () => {
    const res = await fetch(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('retry:');
    await reader.cancel();
  });

  it('asks proxies not to buffer, which would hold every event', async () => {
    const res = await fetch(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    await res.body.cancel();
  });

  it('lets go of a subscriber when its client disappears', async () => {
    const stream = openStream(`${origin}/api/table/${world.tuesday.tableToken}/stream`);
    await stream.ready;
    await stream.waitFor(1);
    expect(Object.values(app.bus.counts()).reduce((a, b) => a + b, 0)).toBe(1);

    stream.close();
    // The close handler runs on the server's next tick.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(Object.values(app.bus.counts()).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
