/**
 * Characters.
 *
 * The sheet is one JSON document with a version per field path, so a GM pushing
 * a condition and a player typing a note do not collide. The patch logic lives
 * in `applyPatch` and is used by both.
 */
import { assertCharacter, assertWritable, campaignFor, isGm, NotFoundError } from '../scope.js';

const COLUMNS = `
  id, campaign_id AS campaignId, player_name AS playerName, name, level,
  sheet, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
`;

const hydrate = (row) => (row ? { ...row, sheet: JSON.parse(row.sheet) } : row);

export function listCharacters(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  return db.prepare(`
    SELECT ${COLUMNS} FROM character WHERE campaign_id = ? ORDER BY sort_order, name
  `).all(campaignId).map(hydrate);
}

/**
 * One character.
 *
 * The campaign filter is in the SQL rather than checked afterwards: a character
 * id from another campaign returns nothing at all, so there is no window in
 * which the row exists in memory before the check runs.
 */
export function getCharacter(db, scope, characterId, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  if (scope.kind === 'character') assertCharacter(scope, characterId);
  const row = db.prepare(`
    SELECT ${COLUMNS} FROM character WHERE id = ? AND campaign_id = ?
  `).get(characterId, campaignId);
  if (!row) throw new NotFoundError('No such character');
  return hydrate(row);
}

/** The character a character token points at, with no id from the client at all. */
export function getOwnCharacter(db, scope) {
  if (scope.kind !== 'character') throw new NotFoundError('Not a character link');
  return getCharacter(db, scope, scope.characterId);
}

export function createCharacter(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new NotFoundError('Only the GM adds a character to a campaign');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const info = db.prepare(`
    INSERT INTO character (campaign_id, player_name, name, level, sheet, sort_order)
    VALUES (@campaignId, @playerName, @name, @level, @sheet, @sortOrder)
  `).run({
    campaignId,
    playerName: fields.playerName ?? '',
    name: fields.name ?? '',
    level: fields.level ?? 1,
    sheet: JSON.stringify(fields.sheet ?? {}),
    sortOrder: fields.sortOrder ?? 0,
  });
  return getCharacter(db, scope, info.lastInsertRowid, campaignId);
}

/**
 * Remove a character, and everything that pointed at them.
 *
 * Three things go together, in one transaction, and the order matters:
 *
 *   1. Their links are revoked. `token.character_id` carries no foreign key,
 *      so deleting the row on its own would leave a live link pointing at a
 *      character that is not there — which is a link that still authenticates.
 *   2. They come out of any fight. `combatant.character_id` is
 *      `ON DELETE SET NULL`, which would leave a nameless row in the initiative
 *      order rather than removing it.
 *   3. The character goes, taking `character_field` with it by cascade.
 *
 * The deleted record is returned whole, sheet included, so the dashboard can
 * offer an undo. What cannot come back is the link: tokens are stored hashed,
 * so restoring the character means minting a new one.
 */
export function deleteCharacter(db, scope, characterId, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new NotFoundError('Only the GM removes a character');
  const campaignId = campaignFor(scope, requestedCampaignId);
  // Reads through getCharacter first, so a character in another campaign is a
  // 404 before anything is written.
  const character = getCharacter(db, scope, characterId, campaignId);

  const remove = db.transaction(() => {
    const links = db.prepare(`
      UPDATE token SET revoked_at = datetime('now')
      WHERE character_id = ? AND campaign_id = ? AND revoked_at IS NULL
    `).run(characterId, campaignId).changes;

    const combatants = db.prepare('DELETE FROM combatant WHERE character_id = ?')
      .run(characterId).changes;

    db.prepare('DELETE FROM character WHERE id = ? AND campaign_id = ?')
      .run(characterId, campaignId);

    return { links, combatants };
  });

  const { links, combatants } = remove();
  return { deleted: Number(characterId), character, revokedLinks: links, removedFrom: combatants };
}

export function versionsFor(db, characterId) {
  const rows = db.prepare(
    'SELECT path, version, updated_at AS updatedAt, updated_by AS updatedBy FROM character_field WHERE character_id = ?',
  ).all(characterId);
  return Object.fromEntries(rows.map((r) => [r.path, r]));
}

/** Read a dotted path out of a plain object. */
export function readPath(object, path) {
  return String(path).split('.').reduce(
    (node, key) => (node === null || node === undefined ? undefined : node[key]),
    object,
  );
}

/** Write a dotted path into a plain object, creating the objects along the way. */
export function writePath(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[last] = value;
  return object;
}

/**
 * Apply a set of field writes.
 *
 * Each write is `{ path, value, baseVersion }`. A write whose baseVersion is
 * behind the stored one is rejected *for that path alone* and reported back
 * with the current value, so a stale note does not cost the player the rest of
 * their edits. Omitting baseVersion means "I do not care", which is what the
 * GM's condition push wants.
 */
export function applyPatch(db, scope, characterId, writes, { by = 'player', campaignId = null } = {}) {
  assertWritable(scope);
  // The GM reaches every campaign, so a GM patch must name the campaign; the
  // read below is what enforces it, and it happens before any write.
  const character = getCharacter(db, scope, characterId, campaignId);
  if (scope.kind === 'character') assertCharacter(scope, characterId);

  const sheet = character.sheet;
  const versions = versionsFor(db, characterId);
  const applied = [];
  const conflicts = [];

  const bump = db.prepare(`
    INSERT INTO character_field (character_id, path, version, updated_at, updated_by)
    VALUES (@characterId, @path, 1, datetime('now'), @by)
    ON CONFLICT(character_id, path) DO UPDATE
      SET version = version + 1, updated_at = datetime('now'), updated_by = @by
  `);

  const run = db.transaction(() => {
    for (const write of writes ?? []) {
      const current = versions[write.path]?.version ?? 0;
      if (write.baseVersion !== undefined && write.baseVersion !== null
          && Number(write.baseVersion) !== current) {
        conflicts.push({
          path: write.path,
          expectedVersion: Number(write.baseVersion),
          currentVersion: current,
          currentValue: readPath(sheet, write.path) ?? null,
        });
        continue;
      }
      writePath(sheet, write.path, write.value);
      bump.run({ characterId, path: write.path, by });
      applied.push({ path: write.path, version: current + 1 });
    }

    if (applied.length) {
      db.prepare(`
        UPDATE character
        SET sheet = @sheet,
            name = COALESCE(@name, name),
            player_name = COALESCE(@playerName, player_name),
            level = COALESCE(@level, level),
            updated_at = datetime('now')
        WHERE id = @id
      `).run({
        id: characterId,
        sheet: JSON.stringify(sheet),
        // These three are denormalized onto the row so the party panel and the
        // initiative screen can read a roster without parsing every sheet.
        name: typeof sheet.name === 'string' ? sheet.name : null,
        playerName: typeof sheet.playerName === 'string' ? sheet.playerName : null,
        level: Number.isFinite(sheet.level) ? sheet.level : null,
      });
    }
  });

  run();

  return {
    character: getCharacter(db, scope, characterId, campaignId),
    versions: versionsFor(db, characterId),
    applied,
    conflicts,
  };
}
