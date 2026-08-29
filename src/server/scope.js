/**
 * Scope: what a token is allowed to touch.
 *
 * Resolved once per request from the token in the URL, and passed to every
 * store function. The rule the whole access model rests on:
 *
 *   A campaign id that arrives from the client is never trusted. It is checked
 *   against the scope, and a mismatch is a refusal, not a silent redirect to
 *   the caller's own campaign.
 *
 * Silent redirection would be friendlier and wrong: it hides a bug, and it
 * turns a probe for another campaign's data into a successful request that
 * merely returned something else.
 */

import { hashToken } from './tokens.js';

export class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
    this.statusCode = 403;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

/**
 * Look a token up and turn it into a scope. Returns null when the token is
 * unknown or revoked -- the caller decides how to respond, and must respond the
 * same way for both so a revoked token cannot be distinguished from a wrong one.
 */
export function resolveScope(db, token) {
  // The database holds the hash, never the link. A copied database file is
  // therefore a list of what exists, not a set of working keys.
  const row = db.prepare(`
    SELECT id, kind, campaign_id, character_id
    FROM token
    WHERE token_hash = ? AND revoked_at IS NULL
  `).get(hashToken(token));

  if (!row) return null;

  // A character token names a character; if that character has been deleted or
  // moved campaigns, the token is dead rather than campaign-wide.
  if (row.kind === 'character') {
    const character = db.prepare(
      'SELECT id, campaign_id FROM character WHERE id = ?',
    ).get(row.character_id);
    if (!character || character.campaign_id !== row.campaign_id) return null;
  }

  return Object.freeze({
    tokenId: row.id,
    kind: row.kind,
    campaignId: row.campaign_id,
    characterId: row.character_id,
  });
}

/** The GM reaches every campaign; everyone else reaches exactly one. */
export function isGm(scope) {
  return scope?.kind === 'gm';
}

/**
 * The campaign this request may act on.
 *
 * @param {object} scope
 * @param {number|string|null} requested  a campaign id from the client, if any
 * @returns {number} the campaign id to query with
 */
export function campaignFor(scope, requested = null) {
  if (!scope) throw new ScopeError('No scope');

  if (isGm(scope)) {
    if (requested === null || requested === undefined) {
      throw new ScopeError('The GM must name a campaign');
    }
    return Number(requested);
  }

  if (requested === null || requested === undefined) return scope.campaignId;

  if (Number(requested) !== scope.campaignId) {
    throw new ScopeError('This link does not reach that campaign');
  }
  return scope.campaignId;
}

/** A character token may write only its own character. */
export function assertCharacter(scope, characterId) {
  if (isGm(scope)) return Number(characterId);
  if (scope.kind !== 'character') {
    throw new ScopeError('This link cannot act on a character sheet');
  }
  if (Number(characterId) !== scope.characterId) {
    throw new ScopeError('This link does not reach that character');
  }
  return scope.characterId;
}

/** The shared screen is read-only, always. */
export function assertWritable(scope) {
  if (scope?.kind === 'table') {
    throw new ScopeError('The shared screen is read-only');
  }
  if (!scope) throw new ScopeError('No scope');
}
