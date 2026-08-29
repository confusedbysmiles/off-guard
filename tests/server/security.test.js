/**
 * The security pass, as assertions.
 *
 * The access model is "the URL is the credential". That is a defensible choice
 * for a table application with no accounts, but only if the token cannot leak
 * sideways -- into a Referer, an index, a log, a page title or an injected
 * script's fetch. Each of those is a line below.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { freshDb, seed } from './helpers.js';
import { stubCatalogue } from './stub-catalogue.js';
import { contentSecurityPolicy } from '../../src/server/security.js';

let app; let db; let world;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({ db, catalogue: stubCatalogue(), logger: false });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const get = (url) => app.inject({ method: 'GET', url });

describe('the headers on every response', () => {
  const surfaces = () => [
    ['a page', `/gm/${world.gmToken}`],
    ['an API call', `/api/gm/${world.gmToken}/campaigns`],
    ['a stylesheet', '/assets/css/tokens.css'],
    ['the rules engine', '/engine/rules/dice.js'],
    ['a refusal', '/gm/NOTAREALTOKENNOTAREALTOK'],
    ['robots.txt', '/robots.txt'],
  ];

  it('sends no-referrer, so no outbound link can carry the token', async () => {
    for (const [what, url] of surfaces()) {
      const res = await get(url);
      expect(res.headers['referrer-policy'], what).toBe('no-referrer');
    }
  });

  it('tells crawlers to stay away', async () => {
    for (const [what, url] of surfaces()) {
      expect((await get(url)).headers['x-robots-tag'], what).toMatch(/noindex/);
    }
    expect((await get('/robots.txt')).body).toBe('User-agent: *\nDisallow: /\n');
  });

  it('refuses framing, sniffing and cross-origin reads', async () => {
    const { headers } = await get(`/gm/${world.gmToken}`);
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('sets a Content-Security-Policy with no unsafe-inline anywhere', async () => {
    const policy = (await get(`/gm/${world.gmToken}`)).headers['content-security-policy'];
    expect(policy).toBeTruthy();
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  /**
   * The one that matters most for this access model. An injected script that
   * could reach any origin could read `location` -- which is the credential --
   * and post it out in a single line.
   */
  it('allows no origin but this one, so nothing can post the URL out', () => {
    const policy = contentSecurityPolicy();
    for (const directive of policy.split('; ')) {
      const [, ...values] = directive.split(' ');
      for (const value of values) {
        expect(
          ["'none'", "'self'", 'data:'].includes(value),
          `${directive} allows ${value}`,
        ).toBe(true);
      }
    }
    expect(policy).toContain("connect-src 'self'");
  });
});

describe('nothing leaks the token', () => {
  it('never puts it in the markup of any page', async () => {
    for (const [kind, token] of [
      ['gm', world.gmToken],
      ['c', world.tuesday.characterToken],
      ['table', world.tuesday.tableToken],
    ]) {
      const html = (await get(`/${kind}/${token}`)).body;
      expect(html, kind).not.toContain(token);
    }
  });

  it('has no og: or twitter: tags to leak into a chat preview', async () => {
    for (const [kind, token] of [
      ['gm', world.gmToken],
      ['c', world.tuesday.characterToken],
      ['table', world.tuesday.tableToken],
    ]) {
      const html = (await get(`/${kind}/${token}`)).body;
      expect(html, kind).not.toMatch(/property="og:|name="twitter:/);
    }
  });

  it('gives every page a title that names nothing', async () => {
    const titles = {};
    for (const [kind, token] of [
      ['gm', world.gmToken],
      ['c', world.tuesday.characterToken],
      ['table', world.tuesday.tableToken],
    ]) {
      const html = (await get(`/${kind}/${token}`)).body;
      titles[kind] = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    }
    expect(titles).toEqual({
      gm: 'Off-Guard',
      c: 'Character sheet',
      table: 'Initiative',
    });
    // Not the campaign, and not the character.
    for (const title of Object.values(titles)) {
      expect(title).not.toMatch(/Abomination|Kestrel|Tuesday/);
    }
  });

  it('records only a fingerprint of a failed attempt, never the token', async () => {
    const guess = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    await get(`/api/c/${guess}`);
    const rows = db.prepare('SELECT token_prefix AS p FROM access_failure').all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.p.length).toBeLessThan(guess.length);
      expect(guess.startsWith(row.p.replace('...', ''))).toBe(true);
    }
  });
});

describe('a wrong link is refused the same way every time', () => {
  it('cannot be told apart from a right one that was revoked', async () => {
    const shapes = [
      'NOTAREALTOKENNOTAREALTOK',          // malformed: too short
      'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',        // well-formed, unknown
      world.tuesday.tableToken,            // real, but the wrong kind here
    ];
    const results = [];
    for (const token of shapes) {
      const res = await get(`/api/c/${token}`);
      results.push({ status: res.statusCode, body: res.body });
    }
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([404]));
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
  });

  it('stops answering after fifteen failures in five minutes', async () => {
    for (let i = 0; i < 15; i += 1) {
      await get(`/api/c/ZZZZZZZZZZZZZZZZZZZZZZZZZ${i % 10}`);
    }
    const res = await get(`/api/c/${world.tuesday.characterToken}`);
    expect(res.statusCode).toBe(429);
  });
});

describe('the shared screen cannot write', () => {
  it('refuses every mutating verb', async () => {
    const token = world.tuesday.tableToken;
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await app.inject({
        method, url: `/api/table/${token}`, payload: {},
      });
      expect([404, 405], `${method} returned ${res.statusCode}`).toContain(res.statusCode);
    }
  });
});
