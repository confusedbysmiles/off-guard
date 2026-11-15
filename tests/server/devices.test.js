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

/**
 * What a browser does: ask once with nothing, then come back with the cookie.
 *
 * A device is written down on the second request, not the first -- see the
 * note in `device-gate.js`. Every test that wants a recorded device has to do
 * what a browser does, because doing less is exactly what a crawler does.
 */
async function visit(options = {}) {
  const secret = cookieFrom(await sheet(options));
  await sheet({ ...options, cookie: secret });
  return secret;
}

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
    await visit({ agent: IPHONE });
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
    await visit();
    await visit({ agent: IPHONE });
    expect(listDevices(db, tokenId())).toHaveLength(2);
  });

  /**
   * The bug this whole rule exists for.
   *
   * A chat client fetching a link preview, a crawler, a private window, curl:
   * none of them keep the cookie, and every one of their requests used to be
   * a device. One player's link had a hundred and sixty-two rows and perhaps
   * three browsers.
   */
  it('does not count anything that never comes back', async () => {
    for (let i = 0; i < 20; i += 1) await sheet();
    expect(listDevices(db, tokenId())).toHaveLength(0);
  });

  it('counts a browser on the request that proves it kept the cookie', async () => {
    const secret = cookieFrom(await sheet());
    expect(listDevices(db, tokenId())).toHaveLength(0);

    await sheet({ cookie: secret });
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });

  /**
   * One cookie serves every link on this origin -- it is salted per token on
   * the way into the table, not per browser -- so a browser arriving at a
   * second link already has the thing the first request exists to hand out.
   */
  it('counts a browser that already has a cookie on its first request here', async () => {
    const elsewhere = cookieFrom(await app.inject({
      method: 'GET', url: `/api/gm/${world.gmToken}/campaigns`,
    }));
    expect(elsewhere).toBeTruthy();

    await sheet({ cookie: elsewhere });
    expect(listDevices(db, tokenId())).toHaveLength(1);
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
    // Both doors run the same gate, so the page hands out the cookie and the
    // sheet's first request records the browser that carried it back. A page
    // nobody's browser followed up on is not a device.
    const page = await app.inject({ method: 'GET', url: `/c/${token()}` });
    expect(page.statusCode).toBe(200);
    const secret = cookieFrom(page);
    expect(secret).toBeTruthy();
    expect(listDevices(db, tokenId())).toHaveLength(0);

    await sheet({ cookie: secret });
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });
});

describe('locking a link to the devices it knows', () => {
  const known = async () => visit({ agent: IPHONE });

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

describe('emptying the list', () => {
  const forgetAll = (id) => app.inject({
    method: 'DELETE', url: `/api/gm/${world.gmToken}/tokens/${id}/devices`,
  });

  it('clears a list that filled up with things that were not devices', async () => {
    await visit();
    await visit({ agent: IPHONE });
    expect(listDevices(db, tokenId())).toHaveLength(2);

    const res = await forgetAll(tokenId());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forgotten: 2 });
    expect(listDevices(db, tokenId())).toHaveLength(0);
  });

  it('costs nothing, because a browser puts itself back when it next asks', async () => {
    const secret = await visit();
    await forgetAll(tokenId());

    expect((await sheet({ cookie: secret })).statusCode).toBe(200);
    expect(listDevices(db, tokenId())).toHaveLength(1);
  });

  /**
   * Emptying the list a lock enforces locks out everybody, including the
   * person the link was minted for, and `npm run unlock` on the server is the
   * only way back. Refused with the reason rather than done.
   */
  it('refuses while the link is locked to that very list', async () => {
    const secret = await visit();
    await lock(tokenId());

    const res = await forgetAll(tokenId());
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/unlock it first/i);
    expect(listDevices(db, tokenId())).toHaveLength(1);
    expect((await sheet({ cookie: secret })).statusCode).toBe(200);
  });

  it('is not the player’s to do', async () => {
    await visit();
    const res = await app.inject({
      method: 'DELETE', url: `/api/gm/${token()}/tokens/${tokenId()}/devices`,
    });
    expect(res.statusCode).toBe(404);
    expect(listDevices(db, tokenId())).toHaveLength(1);
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
    const gmCall = (cookie) => app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns`,
      headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
    });
    await gmCall(cookieFrom(await gmCall()));
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
