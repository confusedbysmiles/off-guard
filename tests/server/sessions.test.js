/**
 * The session log.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const gm = (method, path, body) => app.inject({
  method, url: `/api/gm/${world.gmToken}${path}`, payload: body,
});

const tuesday = () => world.tuesday.campaign.id;

describe('writing up a session', () => {
  it('records it against the campaign', async () => {
    const res = await gm('POST', `/campaigns/${tuesday()}/sessions`, {
      title: 'The sealed door', body: 'They opened it.', playedAt: '2026-08-25',
    });
    expect(res.statusCode).toBe(201);
    const { session } = res.json();
    expect(session.title).toBe('The sealed door');
    expect(session.playedAt).toBe('2026-08-25');
    expect(session.campaignId).toBe(tuesday());
  });

  it('defaults to today when no date is given', async () => {
    const { session } = (await gm('POST', `/campaigns/${tuesday()}/sessions`, {
      title: 'Last night',
    })).json();
    expect(session.playedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a date it cannot read rather than coercing one', async () => {
    const res = await gm('POST', `/campaigns/${tuesday()}/sessions`, {
      title: 'Whenever', playedAt: 'last Tuesday',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/2026-08-29/);
  });

  /**
   * The clearest signal a campaign was played is somebody writing up what
   * happened, and the dashboard opens on the most recently played campaign.
   */
  it('marks the campaign as played', async () => {
    const before = (await gm('GET', '/campaigns')).json()
      .campaigns.find((c) => c.id === tuesday()).lastPlayedAt;
    await gm('POST', `/campaigns/${tuesday()}/sessions`, { title: 'A session' });
    const after = (await gm('GET', '/campaigns')).json()
      .campaigns.find((c) => c.id === tuesday()).lastPlayedAt;
    expect(after).not.toBe(before);
    expect(after).toBeTruthy();
  });

  it('lists most recently played first, whenever it was written', async () => {
    for (const playedAt of ['2026-08-01', '2026-08-20', '2026-08-10']) {
      await gm('POST', `/campaigns/${tuesday()}/sessions`, { title: playedAt, playedAt });
    }
    const { sessions } = (await gm('GET', `/campaigns/${tuesday()}/sessions`)).json();
    expect(sessions.map((s) => s.playedAt)).toEqual(['2026-08-20', '2026-08-10', '2026-08-01']);
  });

  it('edits and deletes, returning the row so an undo can put it back', async () => {
    const { session } = (await gm('POST', `/campaigns/${tuesday()}/sessions`, {
      title: 'Draft', body: 'rough',
    })).json();

    const edited = (await gm('PATCH', `/campaigns/${tuesday()}/sessions/${session.id}`, {
      title: 'Final', body: 'better',
    })).json().session;
    expect(edited.title).toBe('Final');
    expect(edited.playedAt).toBe(session.playedAt);

    const removed = (await gm('DELETE', `/campaigns/${tuesday()}/sessions/${session.id}`)).json();
    expect(removed.deleted.title).toBe('Final');
    expect(removed.deleted.body).toBe('better');
    expect((await gm('GET', `/campaigns/${tuesday()}/sessions`)).json().sessions).toEqual([]);
  });
});

describe('the session log is campaign-scoped like everything else', () => {
  it('never shows another campaign’s sessions', async () => {
    await gm('POST', `/campaigns/${world.saturday.campaign.id}/sessions`, {
      title: 'Kingmaker night',
    });
    const { sessions } = (await gm('GET', `/campaigns/${tuesday()}/sessions`)).json();
    expect(sessions.map((s) => s.title)).not.toContain('Kingmaker night');
  });

  it('cannot edit a session belonging to another campaign', async () => {
    const { session } = (await gm('POST', `/campaigns/${world.saturday.campaign.id}/sessions`, {
      title: 'Kingmaker night',
    })).json();
    const res = await gm('PATCH', `/campaigns/${tuesday()}/sessions/${session.id}`, {
      title: 'Stolen',
    });
    expect(res.statusCode).toBe(404);
  });

  it('is not reachable with a character or table token', async () => {
    for (const token of [world.tuesday.characterToken, world.tuesday.tableToken]) {
      const res = await app.inject({
        method: 'GET', url: `/api/gm/${token}/campaigns/${tuesday()}/sessions`,
      });
      expect(res.statusCode).toBe(404);
    }
  });
});
