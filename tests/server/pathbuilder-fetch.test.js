/**
 * Fetching a build by id.
 *
 * The application's only outbound request. The tests below are about what it
 * does when the answer is not a build, because that is the common case:
 * pathbuilder2e.com sits behind Cloudflare's bot protection, which answers a
 * server with a challenge page. We do not try to get around that -- the
 * request identifies itself honestly and the failure tells the player to use
 * the export file, which always works.
 */
import { describe, expect, it } from 'vitest';

import {
  buildIdFrom, fetchBuild, fetchEnabled, USER_AGENT,
} from '../../src/server/pathbuilder-fetch.js';

const ok = (body) => async () => ({ ok: true, text: async () => JSON.stringify(body) });

describe('the switch', () => {
  it('is on unless the environment turns it off', () => {
    expect(fetchEnabled({})).toBe(true);
    expect(fetchEnabled({ OFF_GUARD_PATHBUILDER_FETCH: 'off' })).toBe(false);
    expect(fetchEnabled({ OFF_GUARD_PATHBUILDER_FETCH: 'OFF' })).toBe(false);
  });

  it('refuses to make the request when it is off', async () => {
    await expect(fetchBuild('1', { env: { OFF_GUARD_PATHBUILDER_FETCH: 'off' } }))
      .rejects.toThrow(/switched off/);
  });
});

describe('the request', () => {
  it('identifies itself honestly rather than as a browser', async () => {
    let seen = null;
    await fetchBuild('145200', {
      env: {},
      fetchImpl: async (url, options) => {
        seen = options;
        return { ok: true, text: async () => '{"success":true,"build":{}}' };
      },
    });
    expect(seen.headers['user-agent']).toBe(USER_AGENT);
    expect(seen.headers['user-agent']).not.toMatch(/Mozilla|Chrome|Safari/);
  });

  it('rejects anything that is not a build id before going anywhere', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; };
    for (const bad of ['', 'abc', '1; DROP TABLE', '../../etc/passwd', '9'.repeat(20)]) {
      await expect(fetchBuild(bad, { env: {}, fetchImpl })).rejects.toThrow(/build id is the number/);
    }
    expect(called).toBe(false);
  });

  it('returns the build when the answer really is a build', async () => {
    const build = await fetchBuild('145200', {
      env: {}, fetchImpl: ok({ success: true, build: { name: 'Kestrel' } }),
    });
    expect(build.build.name).toBe('Kestrel');
  });
});

describe('when the answer is not a build', () => {
  it('explains the bot check and points at the export file', async () => {
    const challenge = async () => ({
      ok: false,
      text: async () => '<!DOCTYPE html><html><head><title>Just a moment...</title>',
    });
    await expect(fetchBuild('145200', { env: {}, fetchImpl: challenge }))
      .rejects.toThrow(/bot check.*Export → JSON/s);
  });

  it('says so when Pathbuilder has no such build', async () => {
    await expect(fetchBuild('1', { env: {}, fetchImpl: ok({ success: false }) }))
      .rejects.toThrow(/no build with id 1/);
  });

  it('reports a network failure as one', async () => {
    const dead = async () => { throw new Error('ENOTFOUND'); };
    await expect(fetchBuild('1', { env: {}, fetchImpl: dead }))
      .rejects.toThrow(/Could not reach Pathbuilder.*ENOTFOUND/);
  });
});

/**
 * What the player is told when it does not work.
 *
 * Found in the journal of the live server: a build id that was not a number
 * threw a 502, and the error handler replaces the body of anything 500 or over
 * with "Something went wrong". So every message this module writes -- each one
 * of them a remedy -- reached the dialog as four words that suggest nothing.
 */
describe('the message that reaches the dialog', () => {
  it('calls a typo the caller’s fault, not Pathbuilder’s', async () => {
    await expect(fetchBuild('not-a-number', { env: {}, fetchImpl: async () => {} }))
      .rejects.toMatchObject({ statusCode: 400, expose: true });
  });

  it('marks an upstream failure as safe to show, because the message is the fix', async () => {
    const refuse = async () => { throw new Error('ECONNREFUSED'); };
    await expect(fetchBuild('145200', { env: {}, fetchImpl: refuse }))
      .rejects.toMatchObject({ statusCode: 502, expose: true });
  });

  it('takes the whole link, which is what people have in hand', () => {
    expect(buildIdFrom('https://pathbuilder2e.com/json.php?id=145200')).toBe('145200');
    expect(buildIdFrom('  145200 ')).toBe('145200');
    expect(buildIdFrom('pathbuilder2e.com/?foo=1&id=987654321')).toBe('987654321');
    expect(buildIdFrom('no digits here')).toBe(null);
    expect(buildIdFrom('')).toBe(null);
  });
});
