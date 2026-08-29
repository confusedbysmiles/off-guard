/**
 * The session log.
 *
 * What happened, per session, per campaign. Written between games rather than
 * during one, which is why it is the only part of the application with no
 * keyboard shortcut and no live updates: nobody is typing here while six people
 * wait.
 *
 * `playedAt` is a date the GM sets, not a timestamp of when the note was
 * written. A session played on Tuesday and written up on Thursday belongs to
 * Tuesday, and sorting by when someone got round to it would put the campaign's
 * history in the wrong order.
 */
import {
  assertWritable, campaignFor, InvalidError, isGm, NotFoundError, ScopeError,
} from '../scope.js';

const COLUMNS = `
  id, campaign_id AS campaignId, played_at AS playedAt, title, body
`;

/** `2026-08-29`, or null. Anything else is refused rather than coerced. */
function asDate(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new InvalidError('A session date has to look like 2026-08-29');
  }
  return text;
}

export function listSessions(db, scope, requestedCampaignId = null, { limit = 100 } = {}) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  if (!isGm(scope)) throw new ScopeError('Only the GM reads the session log');
  return db.prepare(`
    SELECT ${COLUMNS} FROM session_log
    WHERE campaign_id = ? ORDER BY played_at DESC, id DESC LIMIT ?
  `).all(campaignId, Math.min(Number(limit) || 100, 500));
}

const rowById = (db, id, campaignId) => db.prepare(`
  SELECT ${COLUMNS} FROM session_log WHERE id = ? AND campaign_id = ?
`).get(id, campaignId);

export function createSession(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the session log');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const info = db.prepare(`
    INSERT INTO session_log (campaign_id, played_at, title, body)
    VALUES (@campaignId, @playedAt, @title, @body)
  `).run({
    campaignId,
    // Defaulting to today is what a GM writing up last night's game wants, and
    // it is one fewer field to fill in.
    playedAt: asDate(fields.playedAt) ?? new Date().toISOString().slice(0, 10),
    title: String(fields.title ?? '').slice(0, 200),
    body: String(fields.body ?? ''),
  });

  // Writing up a session is the clearest signal there is that a campaign was
  // played, which is what the overview sorts campaigns by.
  touchLastPlayed(db, campaignId);
  return rowById(db, info.lastInsertRowid, campaignId);
}

export function updateSession(db, scope, requestedCampaignId, sessionId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the session log');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const existing = rowById(db, sessionId, campaignId);
  if (!existing) throw new NotFoundError('No such session');

  const sets = [];
  const params = { id: sessionId, campaignId };
  if ('playedAt' in fields) { sets.push('played_at = @playedAt'); params.playedAt = asDate(fields.playedAt, existing.playedAt); }
  if ('title' in fields) { sets.push('title = @title'); params.title = String(fields.title ?? '').slice(0, 200); }
  if ('body' in fields) { sets.push('body = @body'); params.body = String(fields.body ?? ''); }
  if (!sets.length) return existing;

  db.prepare(`
    UPDATE session_log SET ${sets.join(', ')} WHERE id = @id AND campaign_id = @campaignId
  `).run(params);
  return rowById(db, sessionId, campaignId);
}

export function deleteSession(db, scope, requestedCampaignId, sessionId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the session log');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const existing = rowById(db, sessionId, campaignId);
  if (!existing) throw new NotFoundError('No such session');
  db.prepare('DELETE FROM session_log WHERE id = ? AND campaign_id = ?').run(sessionId, campaignId);
  // Returned whole, so the interface can offer an undo rather than a warning.
  return { deleted: existing };
}

function touchLastPlayed(db, campaignId) {
  db.prepare(`
    UPDATE campaign SET last_played_at = datetime('now') WHERE id = ?
  `).run(campaignId);
}
