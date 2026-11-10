/**
 * Handouts, and who may see them.
 *
 * Two rules, and both are access rules: a handout belongs to one campaign, and
 * a handout is the GM's until it is released. Everything else here is
 * bookkeeping; these are the parts that would matter if they were wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;
beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const PDF = Buffer.from('%PDF-1.4\nnot really a pdf, but bytes are bytes\n%%EOF');

const upload = (campaignId, { title = 'The letter', filename = 'letter.pdf', type = 'application/pdf', body = PDF } = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/gm/${world.gmToken}/campaigns/${campaignId}/handouts`
      + `?title=${encodeURIComponent(title)}&filename=${encodeURIComponent(filename)}`,
    headers: { 'content-type': type },
    payload: body,
  });

const tuesday = () => world.tuesday.campaign.id;

describe('uploading', () => {
  it('takes a PDF and gives it back in the listing', async () => {
    const res = await upload(tuesday());
    expect(res.statusCode).toBe(201);
    const { handout } = res.json();
    expect(handout.title).toBe('The letter');
    expect(handout.size).toBe(PDF.length);
    // Never the bytes in a listing.
    expect(handout).not.toHaveProperty('bytes');
  });

  it('refuses anything that could carry script', async () => {
    // The whole point of an allow-list. Served from this origin behind a link
    // that is also a credential, HTML or SVG would run as the application.
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
      const res = await upload(tuesday(), { type, body: Buffer.from('<script>x</script>') });
      expect(res.statusCode, `${type} was accepted`).toBeGreaterThanOrEqual(400);
    }
  });

  it('refuses an empty file', async () => {
    expect((await upload(tuesday(), { body: Buffer.alloc(0) })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('releasing', () => {
  it('is withheld from the player until the GM releases it', async () => {
    const { handout } = (await upload(tuesday())).json();

    const before = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}/handouts` });
    expect(before.json().handouts).toEqual([]);

    // And not reachable by guessing its id either.
    const peek = await app.inject({
      method: 'GET',
      url: `/api/c/${world.tuesday.characterToken}/handouts/${handout.id}/file`,
    });
    expect(peek.statusCode).toBe(404);

    await app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}`,
      payload: { released: true },
    });

    const after = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}/handouts` });
    expect(after.json().handouts.map((h) => h.title)).toEqual(['The letter']);
  });

  it('can be taken back, which stops it being listed', async () => {
    const { handout } = (await upload(tuesday())).json();
    const patch = (released) => app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}`,
      payload: { released },
    });
    await patch(true);
    await patch(false);
    const seen = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}/handouts` });
    expect(seen.json().handouts).toEqual([]);
  });

  it('is visible to the GM before release, so it can be checked', async () => {
    const { handout } = (await upload(tuesday())).json();
    const list = await app.inject({
      method: 'GET', url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts`,
    });
    expect(list.json().handouts).toHaveLength(1);
    const file = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}/file`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PDF)).toBe(true);
  });
});

describe('campaign isolation', () => {
  it('does not reach another campaign’s handouts', async () => {
    const { handout } = (await upload(tuesday())).json();
    await app.inject({
      method: 'PATCH',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}`,
      payload: { released: true },
    });

    // Released, and still not Saturday's.
    const other = await app.inject({
      method: 'GET', url: `/api/c/${world.saturday.characterToken}/handouts`,
    });
    expect(other.json().handouts).toEqual([]);

    const byId = await app.inject({
      method: 'GET',
      url: `/api/c/${world.saturday.characterToken}/handouts/${handout.id}/file`,
    });
    expect(byId.statusCode).toBe(404);
  });

  it('refuses a GM reaching across campaigns with a borrowed id', async () => {
    const { handout } = (await upload(tuesday())).json();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/gm/${world.gmToken}/campaigns/${world.saturday.campaign.id}/handouts/${handout.id}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('is not writable from a player’s link', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/c/${world.tuesday.characterToken}/handouts?title=mine&filename=x.pdf`,
      headers: { 'content-type': 'application/pdf' },
      payload: PDF,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('serving the file', () => {
  it('names it, sizes it, and refuses to let a browser sniff it', async () => {
    const { handout } = (await upload(tuesday(), { filename: 'Act 2 — the letter.pdf' })).json();
    const res = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}/file`,
    });
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    // The em dash survives, via RFC 5987, without breaking the ASCII fallback.
    expect(res.headers['content-disposition']).toMatch(/filename\*=UTF-8''/);
    expect(Number(res.headers['content-length'])).toBe(PDF.length);
  });

  it('downloads rather than renders anything that is not a PDF or an image', async () => {
    const { handout } = (await upload(tuesday(), {
      type: 'text/plain', filename: 'notes.txt', body: Buffer.from('hello'),
    })).json();
    const res = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/handouts/${handout.id}/file`,
    });
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });
});
