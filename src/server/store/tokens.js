/**
 * Minting and rotating access tokens.
 *
 * Rotation revokes rather than deletes: the old row stays so a log line naming
 * its fingerprint still means something, and `revoked_at` makes the old link
 * dead on the next request.
 *
 * **The link is returned once and never again.** Only its SHA-256 is stored, so
 * there is nothing to read back: `listTokens` returns what a link is for, not
 * what it is. Every function here that creates a link returns `{ token, ... }`
 * with the cleartext, and that is the only moment it exists outside the browser
 * it is about to be pasted into. Losing it means rotating, which is the honest
 * consequence of not keeping a copy.
 */
import { hashToken, mintToken } from '../tokens.js';
import { campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

// Deliberately no `token` and no `token_hash`. The first does not exist any
// more and the second is a credential-equivalent: anything that can read it can
// mint requests, so it never leaves this module.
const COLUMNS = `
  id, kind, campaign_id AS campaignId, character_id AS characterId, note,
  created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
`;

/** The GM's own token. Minted by the CLI, never through the API. */
export function mintGmToken(db, { note = '' } = {}) {
  const existing = db.prepare(
    "SELECT id FROM token WHERE kind = 'gm' AND revoked_at IS NULL",
  ).get();
  if (existing) {
    throw new Error('A GM token already exists. Rotate it rather than minting a second.');
  }
  const token = mintToken();
  db.prepare("INSERT INTO token (token_hash, kind, note) VALUES (?, 'gm', ?)")
    .run(hashToken(token), note);
  return token;
}

export function listTokens(db, scope, requestedCampaignId = null) {
  if (!isGm(scope)) throw new ScopeError('Only the GM sees the links');
  const campaignId = campaignFor(scope, requestedCampaignId);
  return db.prepare(`
    SELECT ${COLUMNS} FROM token
    WHERE campaign_id = ? AND revoked_at IS NULL
    ORDER BY kind, id
  `).all(campaignId);
}

export function mintCharacterToken(db, scope, characterId, requestedCampaignId = null) {
  if (!isGm(scope)) throw new ScopeError('Only the GM mints links');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const character = db.prepare('SELECT id FROM character WHERE id = ? AND campaign_id = ?')
    .get(characterId, campaignId);
  if (!character) throw new NotFoundError('No such character');

  const token = mintToken();
  const info = db.prepare(`
    INSERT INTO token (token_hash, kind, campaign_id, character_id)
    VALUES (?, 'character', ?, ?)
  `).run(hashToken(token), campaignId, characterId);
  return { token, ...rowById(db, info.lastInsertRowid) };
}

/** One shared screen per campaign; a second mint rotates the first. */
export function mintTableToken(db, scope, requestedCampaignId = null) {
  if (!isGm(scope)) throw new ScopeError('Only the GM mints links');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const token = mintToken();
  const write = db.transaction(() => {
    db.prepare(`
      UPDATE token SET revoked_at = datetime('now')
      WHERE campaign_id = ? AND kind = 'table' AND revoked_at IS NULL
    `).run(campaignId);
    return db.prepare("INSERT INTO token (token_hash, kind, campaign_id) VALUES (?, 'table', ?)")
      .run(hashToken(token), campaignId).lastInsertRowid;
  });
  return { token, ...rowById(db, write()) };
}

/**
 * Rotate any token, including the GM's own.
 * The old one stops working on the next request, which is the point.
 */
export function rotateToken(db, scope, tokenId) {
  if (!isGm(scope)) throw new ScopeError('Only the GM rotates links');
  const existing = db.prepare(`SELECT ${COLUMNS} FROM token WHERE id = ? AND revoked_at IS NULL`)
    .get(tokenId);
  if (!existing) throw new NotFoundError('No such link');

  const token = mintToken();
  const write = db.transaction(() => {
    db.prepare("UPDATE token SET revoked_at = datetime('now') WHERE id = ?").run(tokenId);
    return db.prepare(`
      INSERT INTO token (token_hash, kind, campaign_id, character_id, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(hashToken(token), existing.kind, existing.campaignId, existing.characterId, existing.note)
      .lastInsertRowid;
  });
  return { token, ...rowById(db, write()) };
}

const rowById = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM token WHERE id = ?`).get(id);

export function touchToken(db, tokenId) {
  db.prepare("UPDATE token SET last_used_at = datetime('now') WHERE id = ?").run(tokenId);
}

export function recordFailure(db, { ip = '', path = '', tokenPrefix = '' }) {
  db.prepare('INSERT INTO access_failure (ip, path, token_prefix) VALUES (?, ?, ?)')
    .run(ip, path, tokenPrefix);
}

/**
 * How many times this address has failed recently.
 *
 * This is what the guessing defence is actually keyed on. A blanket
 * requests-per-minute cap punishes the one legitimate user -- a GM at a table
 * clicking through a dashboard makes several requests per action -- while doing
 * nothing a failure counter does not do better: someone walking the token space
 * produces failures and nothing else.
 */
export function failureCount(db, ip, { minutes = 5 } = {}) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM access_failure
    WHERE ip = ? AND at >= datetime('now', ?)
  `).get(String(ip ?? ''), `-${Number(minutes)} minutes`);
  return row?.n ?? 0;
}

export function recentFailures(db, { minutes = 60 } = {}) {
  return db.prepare(`
    SELECT ip, COUNT(*) AS attempts, MAX(at) AS lastAt
    FROM access_failure
    WHERE at >= datetime('now', ?)
    GROUP BY ip ORDER BY attempts DESC
  `).all(`-${Number(minutes)} minutes`);
}
