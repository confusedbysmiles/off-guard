/**
 * Options this table wrote.
 *
 * Campaign-scoped, unlike the creature catalogue: a heritage is part of a
 * setting rather than a tool, and one table's fiction appearing in another
 * table's picker is a leak, not a convenience. The reasoning is written out in
 * migration 007.
 *
 * Two readers with different rules, which is why there are two list functions.
 * The GM manages these and needs everything; a player's builder needs only the
 * records, and reaches them through a scope that was resolved from their own
 * token rather than through a campaign id they sent.
 */
import {
  assertWritable, campaignFor, InvalidError, isGm, NotFoundError, ScopeError,
} from '../scope.js';
import { HOMEBREW_KINDS, homebrewId, homebrewRecord } from '../../rules/character/homebrew.js';

const COLUMNS = `
  id, campaign_id AS campaignId, kind, name, record,
  created_at AS createdAt, updated_at AS updatedAt
`;

const parse = (row) => ({
  rowId: row.id,
  id: homebrewId(row.kind, row.id),
  campaignId: row.campaignId,
  kind: row.kind,
  name: row.name,
  record: { ...JSON.parse(row.record), id: homebrewId(row.kind, row.id) },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * What the builder overlay needs, for a campaign id that has already been
 * checked.
 *
 * No scope argument, deliberately: this is called on every option search a
 * player makes, and the check that matters happened when the token was
 * resolved. Taking a scope here would invite passing one through that had not
 * been narrowed -- the caller is `app.optionsFor`, and the only campaign id it
 * is ever given is `scope.campaignId`.
 */
export function homebrewFor(db, campaignId) {
  if (!campaignId) return [];
  return db.prepare(`
    SELECT ${COLUMNS} FROM homebrew WHERE campaign_id = ? ORDER BY kind, name
  `).all(campaignId).map((row) => {
    const entry = parse(row);
    return { id: entry.id, record: entry.record };
  });
}

/** Everything about them, for the GM's own screen. */
export function listHomebrew(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  if (!isGm(scope)) throw new ScopeError('Only the GM manages this campaign’s options');
  return db.prepare(`
    SELECT ${COLUMNS} FROM homebrew WHERE campaign_id = ? ORDER BY kind, name
  `).all(campaignId).map(parse);
}

const rowById = (db, id, campaignId) => db.prepare(`
  SELECT ${COLUMNS} FROM homebrew WHERE id = ? AND campaign_id = ?
`).get(id, campaignId);

/**
 * How many characters have chosen this.
 *
 * A substring match on the sheet rather than a join, because a build is one
 * JSON document at `sheet.build` and its choices are not columns. The id is
 * distinctive enough for that to be exact -- `"ancestry:hb-3"` with the quotes
 * appears in a sheet only where a build names it.
 *
 * Used to tell the GM what a delete will do before they do it. It is not a
 * refusal: an option that turns out to be a mistake should be removable, and a
 * build naming one that has gone already degrades to a visible gap, which is
 * the same thing that happens when an upstream bump renames a feat.
 */
export function homebrewUsage(db, campaignId, optionId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM character
    WHERE campaign_id = ? AND sheet LIKE ?
  `).get(campaignId, `%"${optionId}"%`).n;
}

function assertKind(kind) {
  if (!HOMEBREW_KINDS.includes(kind)) {
    throw new InvalidError(`An option is an ancestry, a heritage, a background or a class, not "${kind}"`);
  }
  return kind;
}

/**
 * The name is the one field that is genuinely required.
 *
 * Everything else has a defensible default -- an ancestry with no speed is a
 * 25-foot ancestry -- but a nameless option in a picker is a blank row that
 * cannot be told apart from the next blank row.
 */
function assertName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new InvalidError('Give it a name');
  return trimmed.slice(0, 60);
}

export function createHomebrew(db, scope, requestedCampaignId, fields = {}, lookUps = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes this campaign’s options');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const kind = assertKind(fields.kind);
  const name = assertName(fields.name);

  const record = homebrewRecord(kind, { ...fields, name }, lookUps);
  const info = db.prepare(`
    INSERT INTO homebrew (campaign_id, kind, name, record)
    VALUES (?, ?, ?, ?)
  `).run(campaignId, kind, name, JSON.stringify(record));

  return parse(rowById(db, info.lastInsertRowid, campaignId));
}

/**
 * A whole-record replace rather than a patch.
 *
 * The form sends every field it has, and the record is rebuilt from scratch by
 * the same function that built it -- so a field cleared in the form is cleared
 * on the record, which a merge would not do. The kind cannot change: an
 * ancestry that became a class would leave every build that chose it pointing
 * at something of the wrong shape.
 */
export function updateHomebrew(db, scope, requestedCampaignId, id, fields = {}, lookUps = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes this campaign’s options');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const existing = rowById(db, Number(id), campaignId);
  if (!existing) throw new NotFoundError('No such option');

  const name = assertName(fields.name ?? existing.name);
  const record = homebrewRecord(existing.kind, { ...fields, name }, lookUps);

  db.prepare(`
    UPDATE homebrew SET name = ?, record = ?, updated_at = datetime('now')
    WHERE id = ? AND campaign_id = ?
  `).run(name, JSON.stringify(record), Number(id), campaignId);

  return parse(rowById(db, Number(id), campaignId));
}

export function deleteHomebrew(db, scope, requestedCampaignId, id) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes this campaign’s options');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const info = db.prepare('DELETE FROM homebrew WHERE id = ? AND campaign_id = ?')
    .run(Number(id), campaignId);
  if (!info.changes) throw new NotFoundError('No such option');
  return { deleted: true };
}
