/**
 * Minting and rotating access tokens.
 *
 * Rotation revokes rather than deletes: the old row stays so a log line naming
 * its fingerprint still means something, and `revoked_at` makes the old link
 * dead on the next request.
 */
import { mintToken } from '../tokens.js';
import { campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

const COLUMNS = `
  id, token, kind, campaign_id AS campaignId, character_id AS characterId, note,
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
  db.prepare("INSERT INTO token (token, kind, note) VALUES (?, 'gm', ?)").run(token, note);
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
  db.prepare(`
    INSERT INTO token (token, kind, campaign_id, character_id)
    VALUES (?, 'character', ?, ?)
  `).run(token, campaignId, characterId);
  return db.prepare(`SELECT ${COLUMNS} FROM token WHERE token = ?`).get(token);
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
    db.prepare("INSERT INTO token (token, kind, campaign_id) VALUES (?, 'table', ?)")
      .run(token, campaignId);
  });
  write();
  return db.prepare(`SELECT ${COLUMNS} FROM token WHERE token = ?`).get(token);
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
    db.prepare(`
      INSERT INTO token (token, kind, campaign_id, character_id, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, existing.kind, existing.campaignId, existing.characterId, existing.note);
  });
  write();
  return db.prepare(`SELECT ${COLUMNS} FROM token WHERE token = ?`).get(token);
}

export function touchToken(db, tokenId) {
  db.prepare("UPDATE token SET last_used_at = datetime('now') WHERE id = ?").run(tokenId);
}

export function recordFailure(db, { ip = '', path = '', tokenPrefix = '' }) {
  db.prepare('INSERT INTO access_failure (ip, path, token_prefix) VALUES (?, ?, ?)')
    .run(ip, path, tokenPrefix);
}

export function recentFailures(db, { minutes = 60 } = {}) {
  return db.prepare(`
    SELECT ip, COUNT(*) AS attempts, MAX(at) AS lastAt
    FROM access_failure
    WHERE at >= datetime('now', ?)
    GROUP BY ip ORDER BY attempts DESC
  `).all(`-${Number(minutes)} minutes`);
}
