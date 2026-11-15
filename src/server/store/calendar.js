/**
 * The campaign's calendar: where the party is in the year, and what is on it.
 *
 * Dates here are Golarion's and are validated against the calendar itself --
 * see `src/rules/calendar.js` -- so 31 Rova is refused rather than stored and
 * drawn in a month that has thirty days. The engine is the only authority on
 * what a date is; this layer never parses one by hand.
 *
 * `shared` is the half that matters. An event is the GM's until they hand it
 * over, so the player's listing asks for the shared ones and the GM's asks for
 * all of them -- the same shape as a released handout, and the filter is in
 * the SQL rather than in a view, so an unshared event is not a row a player's
 * request ever holds.
 */
import { fromKey, toKey } from '../../rules/calendar.js';
import {
  assertWritable, campaignFor, InvalidError, isGm, NotFoundError, ScopeError,
} from '../scope.js';

const COLUMNS = `
  id, campaign_id AS campaignId, at, ends_at AS endsAt,
  title, body, shared
`;

/** A Golarion date, or null. Anything else is refused rather than coerced. */
function asDate(value, { required = false, field = 'date' } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new InvalidError(`That ${field} is missing.`);
    return null;
  }
  const key = toKey(fromKey(value));
  if (!key) {
    throw new InvalidError(
      `“${String(value).slice(0, 30)}” is not a date this calendar has. `
      + 'Dates look like 4725-09-14, and the month has to have that many days.',
    );
  }
  return key;
}

/** The row a GM sees, with `shared` as a boolean rather than SQLite's 0 and 1. */
const shape = (row) => (row ? { ...row, shared: Boolean(row.shared) } : null);

/**
 * The calendar, as whoever is asking may see it.
 *
 * A player gets the date and the shared events. The campaign's date is not
 * secret -- the party knows what day it is -- and is the thing the whole tab
 * is built around.
 */
export function readCalendar(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const gm = isGm(scope);

  const campaign = db.prepare(
    'SELECT in_world_date AS date FROM campaign WHERE id = ?',
  ).get(campaignId);
  if (!campaign) throw new NotFoundError('No such campaign');

  const events = db.prepare(`
    SELECT ${COLUMNS} FROM campaign_event
    WHERE campaign_id = ? ${gm ? '' : 'AND shared = 1'}
    ORDER BY at, id
  `).all(campaignId).map(shape);

  return { date: campaign.date ?? null, events };
}

/**
 * Where the party is.
 *
 * Null clears it, which is how a table that set one by accident gets back to
 * having no calendar rather than to having a wrong one.
 */
export function setDate(db, scope, requestedCampaignId, value) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM sets the date');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const date = asDate(value, { field: 'date' });
  const info = db.prepare(
    "UPDATE campaign SET in_world_date = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(date, campaignId);
  if (!info.changes) throw new NotFoundError('No such campaign');
  return { date };
}

const rowById = (db, id, campaignId) => shape(db.prepare(`
  SELECT ${COLUMNS} FROM campaign_event WHERE id = ? AND campaign_id = ?
`).get(Number(id), campaignId));

/** `ends_at` before `at` would draw a span backwards, so it is refused. */
function checkSpan(at, endsAt) {
  if (endsAt && endsAt < at) {
    throw new InvalidError('An event cannot end before it starts.');
  }
  return endsAt;
}

export function createEvent(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the calendar');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const at = asDate(fields.at, { required: true, field: 'date' });
  const endsAt = checkSpan(at, asDate(fields.endsAt, { field: 'end date' }));

  const info = db.prepare(`
    INSERT INTO campaign_event (campaign_id, at, ends_at, title, body, shared)
    VALUES (@campaignId, @at, @endsAt, @title, @body, @shared)
  `).run({
    campaignId,
    at,
    endsAt,
    title: String(fields.title ?? '').slice(0, 200),
    body: String(fields.body ?? '').slice(0, 4000),
    shared: fields.shared ? 1 : 0,
  });
  return rowById(db, info.lastInsertRowid, campaignId);
}

export function updateEvent(db, scope, requestedCampaignId, eventId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the calendar');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const current = rowById(db, eventId, campaignId);
  if (!current) throw new NotFoundError('No such event');

  const at = 'at' in fields ? asDate(fields.at, { required: true, field: 'date' }) : current.at;
  const endsAt = checkSpan(
    at,
    'endsAt' in fields ? asDate(fields.endsAt, { field: 'end date' }) : current.endsAt,
  );

  db.prepare(`
    UPDATE campaign_event
    SET at = @at, ends_at = @endsAt, title = @title, body = @body, shared = @shared,
        updated_at = datetime('now')
    WHERE id = @id AND campaign_id = @campaignId
  `).run({
    id: Number(eventId),
    campaignId,
    at,
    endsAt,
    title: 'title' in fields ? String(fields.title ?? '').slice(0, 200) : current.title,
    body: 'body' in fields ? String(fields.body ?? '').slice(0, 4000) : current.body,
    shared: ('shared' in fields ? fields.shared : current.shared) ? 1 : 0,
  });
  return rowById(db, eventId, campaignId);
}

export function deleteEvent(db, scope, requestedCampaignId, eventId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the calendar');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const info = db.prepare('DELETE FROM campaign_event WHERE id = ? AND campaign_id = ?')
    .run(Number(eventId), campaignId);
  if (!info.changes) throw new NotFoundError('No such event');
  return { deleted: true };
}
