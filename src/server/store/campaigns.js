/**
 * Campaigns.
 *
 * Every function takes a resolved scope. `campaignFor` is the choke point: it
 * either returns an id this scope may use or throws, so no query below can
 * reach a campaign the token does not own.
 */
import { campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

const COLUMNS = `
  id, name, adventure, chapter, party_level AS partyLevel, accent_color AS accentColor,
  notes, next_session_at AS nextSessionAt, last_played_at AS lastPlayedAt,
  archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
`;

/** Every campaign the scope can see: all of them for the GM, one otherwise. */
export function listCampaigns(db, scope, { includeArchived = false } = {}) {
  if (isGm(scope)) {
    const where = includeArchived ? '' : 'WHERE archived_at IS NULL';
    return db.prepare(`SELECT ${COLUMNS} FROM campaign ${where} ORDER BY name`).all();
  }
  const one = db.prepare(`SELECT ${COLUMNS} FROM campaign WHERE id = ?`).get(scope.campaignId);
  return one ? [one] : [];
}

export function getCampaign(db, scope, requestedId = null) {
  const id = campaignFor(scope, requestedId);
  const row = db.prepare(`SELECT ${COLUMNS} FROM campaign WHERE id = ?`).get(id);
  if (!row) throw new NotFoundError('No such campaign');
  return row;
}

export function createCampaign(db, scope, fields) {
  if (!isGm(scope)) throw new ScopeError('Only the GM can create a campaign');
  const info = db.prepare(`
    INSERT INTO campaign (name, adventure, chapter, party_level, accent_color, notes)
    VALUES (@name, @adventure, @chapter, @partyLevel, @accentColor, @notes)
  `).run({
    name: fields.name,
    adventure: fields.adventure ?? null,
    chapter: fields.chapter ?? null,
    partyLevel: fields.partyLevel ?? 1,
    accentColor: fields.accentColor ?? '#667EEA',
    notes: fields.notes ?? '',
  });
  return getCampaign(db, scope, info.lastInsertRowid);
}

const UPDATABLE = {
  name: 'name',
  adventure: 'adventure',
  chapter: 'chapter',
  partyLevel: 'party_level',
  accentColor: 'accent_color',
  notes: 'notes',
  nextSessionAt: 'next_session_at',
  lastPlayedAt: 'last_played_at',
};

export function updateCampaign(db, scope, requestedId, fields) {
  if (!isGm(scope)) throw new ScopeError('Only the GM can change a campaign');
  const id = campaignFor(scope, requestedId);
  const sets = [];
  const params = { id };
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (key in fields) {
      sets.push(`${column} = @${key}`);
      params[key] = fields[key];
    }
  }
  if (!sets.length) return getCampaign(db, scope, id);
  sets.push("updated_at = datetime('now')");
  const changed = db.prepare(`UPDATE campaign SET ${sets.join(', ')} WHERE id = @id`).run(params);
  if (!changed.changes) throw new NotFoundError('No such campaign');
  return getCampaign(db, scope, id);
}

/** Archived, never deleted. */
export function archiveCampaign(db, scope, requestedId, archived = true) {
  if (!isGm(scope)) throw new ScopeError('Only the GM can archive a campaign');
  const id = campaignFor(scope, requestedId);
  db.prepare(`UPDATE campaign SET archived_at = ${archived ? "datetime('now')" : 'NULL'},
              updated_at = datetime('now') WHERE id = ?`).run(id);
  return getCampaign(db, scope, id);
}

/**
 * The cross-campaign view: which table has gone three weeks without me.
 * GM only, by construction -- there is nothing here a player link should see.
 */
export function campaignOverview(db, scope) {
  if (!isGm(scope)) throw new ScopeError('Only the GM sees every campaign at once');
  return db.prepare(`
    SELECT
      c.id, c.name, c.adventure, c.chapter,
      c.party_level      AS partyLevel,
      c.accent_color     AS accentColor,
      c.next_session_at  AS nextSessionAt,
      c.last_played_at   AS lastPlayedAt,
      c.archived_at      AS archivedAt,
      (SELECT COUNT(*) FROM character ch WHERE ch.campaign_id = c.id)  AS characterCount,
      (SELECT COUNT(*) FROM encounter e WHERE e.campaign_id = c.id)    AS encounterCount,
      (SELECT MAX(ch.updated_at) FROM character ch WHERE ch.campaign_id = c.id)
                                                                       AS lastSheetEdit
    FROM campaign c
    ORDER BY c.archived_at IS NOT NULL, c.next_session_at IS NULL, c.next_session_at, c.name
  `).all();
}
