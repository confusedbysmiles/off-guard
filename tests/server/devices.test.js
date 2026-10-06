/**
 * Which devices a link has been opened from, and locking it to them.
 *
 * The access model is that the URL is the credential. This does not replace
 * that and must never look as though it does: the token still decides, and a
 * device can only ever narrow what a token already allows.
 *
 * The load-bearing test is `does not record the device it just refused`. If a
 * refused request still wrote its row, locking a link would mean nothing at
 * all -- anybody holding it could knock once, be turned away, and walk in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';
import { COOKIE, deviceHash, labelFor } from '../../src/server/devices.js';
import { listDevices } from '../../src/server/store/devices.js';
import { resolveScope } from '../../src/server/scope.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const token = () => world.tuesday.characterToken;
const tokenId = () => resolveScope(db, token()).tokenId;

const get = (url, { cookie = null, agent = null } = {}) => app.inject({
  method: 'GET',
  url,
  headers: {
    ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}),
    ...(agent ? { 'user-agent': agent } : {}),
  },
});

const sheet = (options) => get(`/api/c/${token()}`, options);

/** The secret the server just handed out. */
const cookieFrom = (res) => {
  const header = [res.headers['set-cookie']].flat().filter(Boolean)
    .find((value) => value.startsWith(`${COOKIE}=`));
  return header ? header.slice(COOKIE.length + 1).split(';')[0] : null;
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const lock = (id, locked = true) => app.inject({
  method: 'POST', url: `/api/gm/${world.gmToken}/tokens/${id}/lock`, payload: { locked },
});

describe('recording a device', () => {
  it('gives a browser that has none a cookie it cannot read', async () => {
    const res = await sheet();
    expect(res.statusCode).toBe(200);
    const header = [res.headers['set-cookie']].flat().join('; ');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(cookieFrom(res)).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
  });

  it('writes down what it can honestly say, and no more', async () => {
    await sheet({ agent: IPHONE });
    const [device] = listDevices(db, tokenId());
    expect(device.label).toBe('iPhone · Safari');
    // The agent string itself is identifying and the panel has no use for it.
    expect(JSON.stringify(device)).not.toContain('AppleWebKit');
  });

  it('does not count one browser twice', async () => {
    const first = await sheet();
    const secret = cookieFrom(first);
    await sheet({ cookie: secret });
    await sheet({ cookie: secret });
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });

  it('counts a second browser separately', async () => {
    await sheet({ cookie: cookieFrom(await sheet()) });
    await sheet({ agent: IPHONE });
    expect(listDevices(db, tokenId())).toHaveLength(2);
  });

  /**
   * The privacy design. One browser that opens two links produces two
   * unrelatable rows, so the table cannot answer "which links has this person
   * opened" -- a question the feature never needs.
   */
  it('cannot be used to tell that two links were opened by the same browser', () => {
    expect(deviceHash(1, 'SECRET')).not.toBe(deviceHash(2, 'SECRET'));
  });

  it('does not let the page and the API disagree about a device', async () => {
    const page = await app.inject({ method: 'GET', url: `/c/${token()}` });
    expect(page.statusCode).toBe(200);
    expect(cookieFrom(page)).toBeTruthy();
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });
});

describe('locking a link to the devices it knows', () => {
  const known = async () => cookieFrom(await sheet({ agent: IPHONE }));

  it('still lets the devices it knows in', async () => {
    const secret = await known();
    expect((await lock(tokenId())).statusCode).toBe(200);
    expect((await sheet({ cookie: secret })).statusCode).toBe(200);
  });

  it('refuses one it does not, and says why rather than pretending to 404', async () => {
    await known();
    await lock(tokenId());

    const res = await sheet();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/locked to the devices/i);
  });

  /**
   * Without this, locking is theatre: knock once to be recorded, knock again
   * to be let in.
   */
  it('does not record the device it just refused', async () => {
    await known();
    await lock(tokenId());
    expect(listDevices(db, tokenId())).toHaveLength(1);

    const refused = await sheet();
    expect(refused.statusCode).toBe(403);
    expect(cookieFrom(refused)).toBe(null);
    expect(listDevices(db, tokenId())).toHaveLength(1);

    // And a second attempt, now carrying the cookie it was never given.
    expect((await sheet({ cookie: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ' })).statusCode).toBe(403);
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });

  it('shows a locked-out player a page that tells them what to do', async () => {
    await known();
    await lock(tokenId());
    const res = await app.inject({ method: 'GET', url: `/c/${token()}` });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Ask your GM to allow this device');
  });

  it('refuses to lock a link nothing has opened, which would lock out everybody', async () => {
    const res = await lock(tokenId());
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/lock everybody out/i);
  });

  it('lets go again', async () => {
    const secret = await known();
    await lock(tokenId());
    expect((await sheet()).statusCode).toBe(403);

    expect((await lock(tokenId(), false)).statusCode).toBe(200);
    expect((await sheet()).statusCode).toBe(200);
    expect((await sheet({ cookie: secret })).statusCode).toBe(200);
  });

  it('turns forgetting a device into a revocation', async () => {
    const secret = await known();
    await lock(tokenId());
    const [device] = listDevices(db, tokenId());

    const forgotten = await app.inject({
      method: 'DELETE',
      url: `/api/gm/${world.gmToken}/tokens/${tokenId()}/devices/${device.id}`,
    });
    expect(forgotten.statusCode).toBe(200);
    expect((await sheet({ cookie: secret })).statusCode).toBe(403);
  });
});

describe('who may do any of this', () => {
  it('is not the player, for their own link', async () => {
    await sheet();
    const res = await app.inject({
      method: 'POST', url: `/api/gm/${token()}/tokens/${tokenId()}/lock`, payload: { locked: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is not the shared screen', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/gm/${world.tuesday.tableToken}/tokens/${tokenId()}/devices/1`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('reaches the GM their own link’s devices, which no campaign lists', async () => {
    await app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}/campaigns` });
    const me = (await app.inject({
      method: 'GET', url: `/api/gm/${world.gmToken}/me`,
    })).json();
    expect(me.kind).toBe('gm');
    expect(me.devices.length).toBeGreaterThan(0);
    expect(me.lockedAt).toBe(null);
  });
});

describe('the labels', () => {
  it('say the platform and the browser, or admit they do not know', () => {
    expect(labelFor(IPHONE)).toBe('iPhone · Safari');
    expect(labelFor('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0'))
      .toBe('Windows · Firefox');
    // Chrome says Safari too, and Edge says both; order decides.
    expect(labelFor('Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120 Safari/537.36'))
      .toBe('Mac · Chrome');
    expect(labelFor('')).toBe('Unknown device');
  });
});
