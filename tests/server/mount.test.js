/**
 * Serving from a subdirectory.
 *
 * The brief puts this application at `drseim.com/off-guard`, not at the root of
 * a host. That is one setting on the server and nothing at all in the browser:
 * the pages work their own mount point out from their address, so the same
 * files are served either way.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, normalizeBasePath } from '../../src/server/app.js';
import { freshDb, seed } from './helpers.js';
import { stubCatalogue } from './stub-catalogue.js';

describe('the base path is normalized to one form', () => {
  it('accepts every way of writing it', () => {
    for (const written of ['/off-guard', 'off-guard', 'off-guard/', '/off-guard/', '//off-guard//']) {
      expect(normalizeBasePath(written), written).toBe('/off-guard');
    }
  });

  it('treats empty, missing and a lone slash as the host root', () => {
    for (const written of ['', '/', '   ', null, undefined]) {
      expect(normalizeBasePath(written)).toBe('');
    }
  });
});

describe('mounted at a subdirectory', () => {
  let app; let db; let world;

  beforeEach(async () => {
    db = freshDb();
    world = seed(db);
    app = await buildApp({
      db, catalogue: stubCatalogue(), logger: false, basePath: '/off-guard',
    });
    await app.ready();
  });
  afterEach(async () => { await app.close(); db.close(); });

  const get = (url) => app.inject({ method: 'GET', url });

  it('serves every page under the prefix', async () => {
    for (const [path, token] of [
      ['gm', world.gmToken],
      ['c', world.tuesday.characterToken],
      ['table', world.tuesday.tableToken],
    ]) {
      const res = await get(`/off-guard/${path}/${token}`);
      expect(res.statusCode, path).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    }
  });

  it('serves the API under the prefix', async () => {
    const res = await get(`/off-guard/api/gm/${world.gmToken}/campaigns`);
    expect(res.statusCode).toBe(200);
    expect(res.json().campaigns).toHaveLength(2);
  });

  it('serves the assets and the rules engine under the prefix', async () => {
    expect((await get('/off-guard/assets/css/tokens.css')).statusCode).toBe(200);
    expect((await get('/off-guard/engine/rules/dice.js')).statusCode).toBe(200);
  });

  it('answers nothing at the host root', async () => {
    for (const path of [
      `/gm/${world.gmToken}`,
      `/api/gm/${world.gmToken}/campaigns`,
      '/assets/css/tokens.css',
      '/healthz',
    ]) {
      expect((await get(path)).statusCode, path).toBe(404);
    }
  });

  it('still refuses a wrong token under the prefix', async () => {
    const res = await get(`/off-guard/gm/${world.tuesday.characterToken}`);
    expect(res.statusCode).toBe(404);
  });

  it('carries the same security headers under the prefix', async () => {
    const res = await get(`/off-guard/gm/${world.gmToken}`);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('the pages ask for nothing root-absolute', () => {
  let app; let db; let world;

  beforeEach(async () => {
    db = freshDb();
    world = seed(db);
    app = await buildApp({ db, catalogue: stubCatalogue(), logger: false, basePath: '/off-guard' });
    await app.ready();
  });
  afterEach(async () => { await app.close(); db.close(); });

  /**
   * The load-bearing assertion. A single `href="/assets/..."` anywhere in these
   * shells would work perfectly at a host root and 404 for every player the
   * moment the application moved into a subdirectory -- and it would do it
   * silently, as an unstyled page rather than an error.
   */
  it('has no root-absolute href or src in any shell', async () => {
    for (const [path, token] of [
      ['gm', world.gmToken],
      ['c', world.tuesday.characterToken],
      ['table', world.tuesday.tableToken],
    ]) {
      const html = (await app.inject({
        method: 'GET', url: `/off-guard/${path}/${token}`,
      })).body;
      expect(html, path).not.toMatch(/(?:href|src)="\/[^/]/);
    }
  });

  it('resolves what the pages actually ask for', async () => {
    // A page at /off-guard/gm/<token> resolves `../assets/x` against
    // /off-guard/gm/, giving /off-guard/assets/x. Walk that arithmetic for real
    // rather than trusting it.
    const html = (await app.inject({
      method: 'GET', url: `/off-guard/gm/${world.gmToken}`,
    })).body;

    const referenced = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(3);

    for (const reference of referenced) {
      if (!reference.startsWith('../')) continue;
      const resolved = new URL(reference, `http://x/off-guard/gm/${world.gmToken}`).pathname;
      expect(resolved.startsWith('/off-guard/'), `${reference} -> ${resolved}`).toBe(true);
      const res = await app.inject({ method: 'GET', url: resolved });
      expect(res.statusCode, resolved).toBe(200);
    }
  });
});
