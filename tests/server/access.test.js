/**
 * The access model itself: token shape, rotation, indistinguishable refusals,
 * rate limiting, and the headers that stop a token leaking sideways.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { resolveScope } from '../../src/server/scope.js';
import { rotateToken } from '../../src/server/store/tokens.js';
import { hashToken, isWellFormed, mintToken, normalizeToken, tokenFingerprint } from '../../src/server/tokens.js';
import { contentSecurityPolicy } from '../../src/server/security.js';
import { freshApp, freshDb, seed } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

describe('token shape', () => {
  it('is 26 characters of Crockford base32, which is 128 bits', () => {
    const token = mintToken();
    expect(token).toHaveLength(26);
    expect(isWellFormed(token)).toBe(true);
  });

  it('excludes the ambiguous letters', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(mintToken()).not.toMatch(/[ILOU]/);
    }
  });

  it('reads back a token typed by hand from a phone screen', () => {
    // Crockford's own rules: case-insensitive, and the excluded letters map to
    // the digits they resemble.
    expect(normalizeToken('abc-def ghi')).toBe('ABCDEFGH1');
    expect(normalizeToken('l0O1')).toBe('1001');
  });

  it('never puts a whole token in a log line', () => {
    const token = mintToken();
    const printed = tokenFingerprint(token);
    expect(printed).toHaveLength(7);
    expect(token.startsWith(printed.slice(0, 4))).toBe(true);
  });
});

describe('refusals are indistinguishable', () => {
  it('answers 404 for malformed, unknown and revoked tokens alike', async () => {
    const malformed = await app.inject({ method: 'GET', url: '/api/c/nope' });
    const unknown = await app.inject({ method: 'GET', url: `/api/c/${mintToken()}` });

    const gm = resolveScope(db, world.gmToken);
    const original = world.tuesday.characterToken;
    const tokenRow = db.prepare('SELECT id FROM token WHERE token_hash = ?')
      .get(hashToken(original));
    rotateToken(db, gm, tokenRow.id);
    const revoked = await app.inject({ method: 'GET', url: `/api/c/${original}` });

    for (const res of [malformed, unknown, revoked]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not found' });
    }
  });

  it('makes the rotated link work and the old one not', async () => {
    const gm = resolveScope(db, world.gmToken);
    const before = world.tuesday.characterToken;
    const row = db.prepare('SELECT id FROM token WHERE token_hash = ?').get(hashToken(before));
    const after = rotateToken(db, gm, row.id).token;

    expect((await app.inject({ method: 'GET', url: `/api/c/${before}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/c/${after}` })).statusCode).toBe(200);
  });

  it('records a failed attempt without recording the token', async () => {
    const guess = mintToken();
    await app.inject({ method: 'GET', url: `/api/c/${guess}` });
    const row = db.prepare('SELECT ip, token_prefix AS prefix FROM access_failure').get();
    expect(row.prefix).toBe(tokenFingerprint(guess));
    expect(row.prefix.length).toBeLessThan(guess.length);
  });
});

describe('the guessing defence', () => {
  it('cuts off an address that keeps failing', async () => {
    let limited = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/c/${mintToken()}` });
      if (res.statusCode === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('does not throttle a working link, however busy the session', async () => {
    // The defence counts failures, not requests. A GM at a table makes several
    // requests per action, and a cap tight enough to matter to an attacker
    // would throttle the one person the application exists for.
    for (let i = 0; i < 120; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}` });
      expect(res.statusCode, `request ${i}`).toBe(200);
    }
  });

  it('stops a page load from a guessing address too', async () => {
    for (let i = 0; i < 20; i += 1) {
      await app.inject({ method: 'GET', url: `/c/${mintToken()}` });
    }
    const res = await app.inject({ method: 'GET', url: `/c/${mintToken()}` });
    expect(res.statusCode).toBe(429);
  });
});

describe('headers', () => {
  it('sends no-referrer, so a link out of a sheet cannot carry the token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/c/${world.tuesday.characterToken}` });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('asks every crawler not to index anything', async () => {
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.body).toContain('Disallow: /');
    expect(res.headers['x-robots-tag']).toContain('noindex');
  });

  it('sets a policy with no unsafe-inline and no remote origin', () => {
    const csp = contentSecurityPolicy('abc123');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("nonce-abc123");
  });

  it('sends the security headers on a refusal too', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/c/nope' });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBeTruthy();
  });
});

describe('the GM token is unique', () => {
  it('cannot be minted twice', async () => {
    const { mintGmToken } = await import('../../src/server/store/tokens.js');
    const clean = freshDb();
    mintGmToken(clean);
    expect(() => mintGmToken(clean)).toThrow(/already exists/);
    clean.close();
  });

  it('rotates to a new one that reaches every campaign', async () => {
    const gm = resolveScope(db, world.gmToken);
    const row = db.prepare("SELECT id FROM token WHERE kind = 'gm'").get();
    const rotated = rotateToken(db, gm, row.id).token;

    const before = await app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}/campaigns` });
    const after = await app.inject({ method: 'GET', url: `/api/gm/${rotated}/campaigns` });
    expect(before.statusCode).toBe(404);
    expect(after.statusCode).toBe(200);
    expect(after.json().campaigns).toHaveLength(2);
  });
});

describe('the schema refuses an unscoped token', () => {
  it('will not store a character token without a campaign', () => {
    const clean = freshDb();
    expect(() => clean.prepare(
      "INSERT INTO token (token_hash, kind) VALUES (?, 'character')",
    ).run(hashToken(mintToken()))).toThrow(/CHECK constraint/);
    clean.close();
  });

  it('will not store a GM token that names a campaign', () => {
    const clean = freshDb();
    const world2 = seed(clean);
    expect(() => clean.prepare(
      "INSERT INTO token (token_hash, kind, campaign_id) VALUES (?, 'gm', ?)",
    ).run(hashToken(mintToken()), world2.tuesday.campaign.id)).toThrow(/CHECK constraint/);
    clean.close();
  });
});


describe('tokens at rest', () => {
  it('stores the hash and not the link', () => {
    const columns = db.prepare('PRAGMA table_info(token)').all().map((c) => c.name);
    expect(columns).toContain('token_hash');
    expect(columns).not.toContain('token');

    // Belt and braces: the link itself appears nowhere in the table.
    const stored = db.prepare('SELECT * FROM token').all();
    expect(JSON.stringify(stored)).not.toContain(world.gmToken);
    expect(JSON.stringify(stored)).not.toContain(world.tuesday.characterToken);
  });

  it('finds a token by its hash', () => {
    const row = db.prepare('SELECT kind FROM token WHERE token_hash = ?')
      .get(hashToken(world.gmToken));
    expect(row.kind).toBe('gm');
  });

  it('never hands a stored link back', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}/tokens`,
    });
    const body = res.json();
    expect(body.retrievable).toBe(false);
    expect(body.tokens.length).toBeGreaterThan(0);
    for (const token of body.tokens) {
      expect(token).not.toHaveProperty('token');
      expect(token).not.toHaveProperty('tokenHash');
    }
    expect(JSON.stringify(body)).not.toContain(world.tuesday.characterToken);
  });

  it('shows a minted link exactly once, in the response that made it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}/tokens/table`,
    });
    const { token } = res.json();
    expect(token.token).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // It works...
    expect((await app.inject({ method: 'GET', url: `/api/table/${token.token}` })).statusCode)
      .toBe(200);
    // ...and it is not in the listing that follows.
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gm/${world.gmToken}/campaigns/${world.tuesday.campaign.id}/tokens`,
    });
    expect(JSON.stringify(listed.json())).not.toContain(token.token);
  });

  it('hashes deterministically and differently per token', () => {
    const a = mintToken();
    const b = mintToken();
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
