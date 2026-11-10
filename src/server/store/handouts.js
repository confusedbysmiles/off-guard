/**
 * Handouts.
 *
 * The letters, maps and player aids a table passes round, held by the
 * application rather than linked to somebody else's. See
 * `migrations/009_handouts.sql` for why the bytes are in the database.
 *
 * Two rules, and both are access rules:
 *
 *   1. A handout belongs to a campaign, and every read resolves the campaign
 *      from the scope the way everything else does. A character token reaches
 *      its own campaign's handouts and no others.
 *   2. A handout is the GM's until it is released. `released_at` is null by
 *      default and only the GM's own routes can see an unreleased one -- the
 *      filter is in the SQL rather than applied afterwards, so there is no
 *      window in which an unreleased handout exists in memory on a player's
 *      request.
 *
 * What may be uploaded is deliberately short. Serving arbitrary bytes from the
 * application's own origin, behind a link that is also a credential, is how a
 * handout becomes a cross-site scripting hole: HTML and SVG can carry script
 * and would run as the application. Neither is on the list, and the list is
 * what is allowed rather than what is forbidden.
 */
import {
  assertWritable, campaignFor, InvalidError, isGm, NotFoundError, ScopeError,
} from '../scope.js';

/** Everything but the bytes. No listing ever loads a blob. */
const COLUMNS = `
  id, campaign_id AS campaignId, title, filename, content_type AS contentType,
  size, sort_order AS sortOrder, released_at AS releasedAt, created_at AS createdAt
`;

/**
 * What may be uploaded, and how it may be served.
 *
 * `inline` says whether a browser may render it in place. PDFs and images are
 * what a player wants to look at on a phone; everything else downloads. HTML
 * and SVG are absent on purpose and must stay absent: both can carry script,
 * and script served from this origin runs with the application's own access.
 */
export const ALLOWED_TYPES = new Map([
  ['application/pdf', { extension: 'pdf', inline: true }],
  ['image/png', { extension: 'png', inline: true }],
  ['image/jpeg', { extension: 'jpg', inline: true }],
  ['image/webp', { extension: 'webp', inline: true }],
  ['text/plain', { extension: 'txt', inline: false }],
  ['text/markdown', { extension: 'md', inline: false }],
]);

/** 25 MB. A scanned map is a few; a video is not a handout. */
export const MAX_BYTES = 25 * 1024 * 1024;

const clean = (value, limit) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);

/**
 * A filename safe to hand back in a header.
 *
 * Directory separators and control characters are removed rather than
 * escaped: this never touches a filesystem, so the only thing a path could do
 * here is confuse a browser's save dialog.
 */
function safeFilename(name, contentType) {
  const base = String(name ?? '').replace(/[\\/\u0000-\u001F\u007F"]+/g, ' ').trim().slice(0, 120);
  if (base) return base;
  return `handout.${ALLOWED_TYPES.get(contentType)?.extension ?? 'bin'}`;
}

export function listHandouts(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  // The GM sees everything; everybody else sees what has been released. In the
  // SQL, so an unreleased handout is never a row this process has in hand on a
  // player's request.
  const releasedOnly = isGm(scope) ? '' : 'AND released_at IS NOT NULL';
  return db.prepare(`
    SELECT ${COLUMNS} FROM handout
    WHERE campaign_id = ? ${releasedOnly}
    ORDER BY sort_order, id
  `).all(campaignId);
}

/** One handout's bytes, for serving. Same release rule as the listing. */
export function readHandout(db, scope, handoutId, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const releasedOnly = isGm(scope) ? '' : 'AND released_at IS NOT NULL';
  const row = db.prepare(`
    SELECT ${COLUMNS}, bytes FROM handout
    WHERE id = ? AND campaign_id = ? ${releasedOnly}
  `).get(handoutId, campaignId);
  // Not found and not yours are the same answer, as everywhere else here.
  if (!row) throw new NotFoundError('No such handout');
  return row;
}

export function createHandout(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM adds a handout');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const contentType = String(fields.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new InvalidError(
      `A handout can be a PDF, a PNG, a JPEG, a WebP, plain text or Markdown. `
      + `This one says it is ${contentType || 'nothing in particular'}.`,
    );
  }

  const bytes = fields.bytes;
  if (!bytes || !bytes.length) throw new InvalidError('That file is empty');
  if (bytes.length > MAX_BYTES) {
    throw new InvalidError(
      `That file is ${Math.ceil(bytes.length / 1024 / 1024)} MB and the limit is `
      + `${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const filename = safeFilename(fields.filename, contentType);
  // The filename makes a reasonable default title, without its extension:
  // "Surveyor's Plan", not "Surveyor's Plan.pdf". The filename itself is kept
  // whole, because that is what a download is called.
  const title = clean(fields.title, 120) || clean(filename.replace(/\.[A-Za-z0-9]{1,5}$/, ''), 120)
    || filename;
  const next = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM handout WHERE campaign_id = ?',
  ).get(campaignId).n;

  const info = db.prepare(`
    INSERT INTO handout (campaign_id, title, filename, content_type, size, bytes, sort_order)
    VALUES (@campaignId, @title, @filename, @contentType, @size, @bytes, @sortOrder)
  `).run({
    campaignId, title, filename, contentType,
    size: bytes.length, bytes, sortOrder: next,
  });

  return db.prepare(`SELECT ${COLUMNS} FROM handout WHERE id = ?`).get(info.lastInsertRowid);
}

/**
 * Release it to the party, or take it back.
 *
 * Taking one back is allowed and does not pretend to be an undo: a player who
 * has already downloaded it has it. What it does is stop it appearing on the
 * sheet, which is the useful half when the wrong thing was released.
 */
export function setReleased(db, scope, requestedCampaignId, handoutId, released) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM releases a handout');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const info = db.prepare(`
    UPDATE handout SET released_at = ${released ? "datetime('now')" : 'NULL'}
    WHERE id = ? AND campaign_id = ?
  `).run(handoutId, campaignId);
  if (!info.changes) throw new NotFoundError('No such handout');
  return db.prepare(`SELECT ${COLUMNS} FROM handout WHERE id = ?`).get(handoutId);
}

export function renameHandout(db, scope, requestedCampaignId, handoutId, title) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM renames a handout');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const next = clean(title, 120);
  if (!next) throw new InvalidError('A handout needs a name');
  const info = db.prepare('UPDATE handout SET title = ? WHERE id = ? AND campaign_id = ?')
    .run(next, handoutId, campaignId);
  if (!info.changes) throw new NotFoundError('No such handout');
  return db.prepare(`SELECT ${COLUMNS} FROM handout WHERE id = ?`).get(handoutId);
}

export function deleteHandout(db, scope, requestedCampaignId, handoutId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM removes a handout');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const row = db.prepare(`SELECT ${COLUMNS} FROM handout WHERE id = ? AND campaign_id = ?`)
    .get(handoutId, campaignId);
  if (!row) throw new NotFoundError('No such handout');
  db.prepare('DELETE FROM handout WHERE id = ? AND campaign_id = ?').run(handoutId, campaignId);
  return { deleted: Number(handoutId), handout: row };
}
