/**
 * The campaign calendar.
 *
 * The load-bearing test is `keeps an unshared event off the player's tab`. An
 * event is the GM's until they hand it over -- the day the cult completes its
 * ritual sits on the calendar for weeks before the party has any business
 * knowing it is there -- and a filter applied in a view rather than in the SQL
 * is a filter somebody eventually forgets.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;
beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const campaignId = () => world.tuesday.campaign.id;
const gm = (path, method = 'GET', payload) => app.inject({
  method, url: `/api/gm/${world.gmToken}/campaigns/${campaignId()}${path}`, payload,
});
const player = (token = world.tuesday.characterToken) =>
  app.inject({ method: 'GET', url: `/api/c/${token}/calendar` });

const addEvent = (fields) => gm('/calendar/events', 'POST', fields);

describe('where the party is', () => {
  it('has no calendar until somebody sets one', async () => {
    const body = (await gm('/calendar')).json();
    expect(body.date).toBe(null);
    expect(body.events).toEqual([]);
    // And the player is told the same thing rather than a year nobody chose.
    expect((await player()).json().date).toBe(null);
  });

  it('takes a date and gives it back to both sides', async () => {
    expect((await gm('/calendar/date', 'PUT', { date: '4725-09-14' })).statusCode).toBe(200);
    expect((await gm('/calendar')).json().date).toBe('4725-09-14');
    expect((await player()).json().date).toBe('4725-09-14');
  });

  it('refuses a date the calendar does not have', async () => {
    for (const date of ['4725-09-31', '4725-13-01', '4725-02-29', 'tomorrow', '2025-09-14T00:00:00Z']) {
      const res = await gm('/calendar/date', 'PUT', { date });
      expect(res.statusCode, date).toBe(400);
      expect(res.json().error).toMatch(/not a date this calendar has/i);
    }
    // 4724 is a leap year, so the same day of Calistril is fine there.
    expect((await gm('/calendar/date', 'PUT', { date: '4724-02-29' })).statusCode).toBe(200);
  });

  it('clears back to having no calendar rather than a wrong one', async () => {
    await gm('/calendar/date', 'PUT', { date: '4725-09-14' });
    expect((await gm('/calendar/date', 'PUT', { date: null })).statusCode).toBe(200);
    expect((await gm('/calendar')).json().date).toBe(null);
  });
});

describe('what is marked on it', () => {
  it('records an event, and a span that runs over several days', async () => {
    const one = await addEvent({ at: '4725-09-21', title: 'Ulfen envoy arrives', shared: true });
    expect(one.statusCode).toBe(201);
    expect(one.json().event).toMatchObject({
      at: '4725-09-21', endsAt: null, title: 'Ulfen envoy arrives', shared: true,
    });

    const span = await addEvent({ at: '4725-09-25', endsAt: '4725-10-02', title: 'The crossing' });
    expect(span.json().event).toMatchObject({ at: '4725-09-25', endsAt: '4725-10-02' });
  });

  it('refuses a span that ends before it starts', async () => {
    const res = await addEvent({ at: '4725-09-25', endsAt: '4725-09-20', title: 'Backwards' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cannot end before it starts/i);
  });

  it('is edited and removed by the GM', async () => {
    const { event } = (await addEvent({ at: '4725-09-21', title: 'Envoy' })).json();

    const edited = await gm(`/calendar/events/${event.id}`, 'PATCH', { title: 'Envoy, late', shared: true });
    expect(edited.json().event).toMatchObject({ title: 'Envoy, late', shared: true });
    // What was not sent is left alone.
    expect(edited.json().event.at).toBe('4725-09-21');

    expect((await gm(`/calendar/events/${event.id}`, 'DELETE')).statusCode).toBe(200);
    expect((await gm('/calendar')).json().events).toEqual([]);
  });

  it('comes back in date order, not the order it was written', async () => {
    await addEvent({ at: '4725-10-02', title: 'Third' });
    await addEvent({ at: '4725-09-14', title: 'First' });
    await addEvent({ at: '4725-09-21', title: 'Second' });
    expect((await gm('/calendar')).json().events.map((e) => e.title))
      .toEqual(['First', 'Second', 'Third']);
  });
});

describe('who may see what', () => {
  it('keeps an unshared event off the player’s tab', async () => {
    await addEvent({ at: '4725-09-21', title: 'The ritual completes', shared: false });
    await addEvent({ at: '4725-09-14', title: 'Market day', shared: true });

    const seen = (await player()).json();
    expect(seen.events.map((e) => e.title)).toEqual(['Market day']);
    // Not merely hidden: the words are not in the response at all.
    expect(JSON.stringify(seen)).not.toContain('ritual');
  });

  it('shows the GM both halves', async () => {
    await addEvent({ at: '4725-09-21', title: 'The ritual completes', shared: false });
    await addEvent({ at: '4725-09-14', title: 'Market day', shared: true });
    expect((await gm('/calendar')).json().events.map((e) => e.shared)).toEqual([true, false]);
  });

  it('is not the player’s to write', async () => {
    for (const [method, path] of [
      ['PUT', '/calendar/date'], ['POST', '/calendar/events'],
    ]) {
      const res = await app.inject({
        method,
        url: `/api/gm/${world.tuesday.characterToken}/campaigns/${campaignId()}${path}`,
        payload: { date: '4725-01-01', at: '4725-01-01', title: 'Mine now' },
      });
      expect(res.statusCode, `${method} ${path}`).toBe(404);
    }
  });

  it('does not reach a player in another campaign', async () => {
    await gm('/calendar/date', 'PUT', { date: '4725-09-14' });
    await addEvent({ at: '4725-09-14', title: 'Market day', shared: true });

    // The Saturday player has their own campaign, and it has no calendar.
    const other = (await player(world.saturday.characterToken)).json();
    expect(other.date).toBe(null);
    expect(other.events).toEqual([]);
  });
});
