/**
 * Encounters.
 *
 * An encounter belongs to one campaign and can be copied to another. Copying is
 * a GM-only operation by construction: it is the only place in the application
 * that touches two campaigns in one statement, so it takes both ids explicitly
 * and checks both.
 */
import { assertWritable, campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

const COLUMNS = `
  id, campaign_id AS campaignId, name, adventure, chapter, sort_order AS sortOrder,
  notes, terrain, lighting, treasure,
  party_level_override AS partyLevelOverride, party_size_override AS partySizeOverride,
  created_at AS createdAt, updated_at AS updatedAt
`;

const CREATURE_COLUMNS = `
  id, encounter_id AS encounterId, creature_id AS creatureId, display_name AS displayName,
  adjustment, level_scale AS levelScale, count, notes, sort_order AS sortOrder
`;

export function listEncounters(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  return db.prepare(`
    SELECT ${COLUMNS} FROM encounter WHERE campaign_id = ? ORDER BY sort_order, name
  `).all(campaignId);
}

export function getEncounter(db, scope, encounterId, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const row = db.prepare(`
    SELECT ${COLUMNS} FROM encounter WHERE id = ? AND campaign_id = ?
  `).get(encounterId, campaignId);
  if (!row) throw new NotFoundError('No such encounter');
  return { ...row, creatures: creaturesIn(db, row.id) };
}

function creaturesIn(db, encounterId) {
  return db.prepare(`
    SELECT ${CREATURE_COLUMNS} FROM encounter_creature WHERE encounter_id = ? ORDER BY sort_order, id
  `).all(encounterId);
}

export function createEncounter(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM builds encounters');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const info = db.prepare(`
    INSERT INTO encounter (campaign_id, name, adventure, chapter, sort_order,
                           notes, terrain, lighting, treasure,
                           party_level_override, party_size_override)
    VALUES (@campaignId, @name, @adventure, @chapter, @sortOrder,
            @notes, @terrain, @lighting, @treasure,
            @partyLevelOverride, @partySizeOverride)
  `).run({
    campaignId,
    name: fields.name ?? 'Untitled encounter',
    adventure: fields.adventure ?? null,
    chapter: fields.chapter ?? null,
    sortOrder: fields.sortOrder ?? 0,
    notes: fields.notes ?? '',
    terrain: fields.terrain ?? '',
    lighting: fields.lighting ?? '',
    treasure: fields.treasure ?? '',
    partyLevelOverride: fields.partyLevelOverride ?? null,
    partySizeOverride: fields.partySizeOverride ?? null,
  });
  return getEncounter(db, scope, info.lastInsertRowid, campaignId);
}

export function deleteEncounter(db, scope, encounterId, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM deletes encounters');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const info = db.prepare('DELETE FROM encounter WHERE id = ? AND campaign_id = ?')
    .run(encounterId, campaignId);
  if (!info.changes) throw new NotFoundError('No such encounter');
  return { deleted: Number(encounterId) };
}

export function setCreatures(db, scope, encounterId, creatures, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM builds encounters');
  const campaignId = campaignFor(scope, requestedCampaignId);
  // Reads through getEncounter first, so an encounter in another campaign is a
  // 404 before anything is written.
  getEncounter(db, scope, encounterId, campaignId);

  const write = db.transaction(() => {
    db.prepare('DELETE FROM encounter_creature WHERE encounter_id = ?').run(encounterId);
    const insert = db.prepare(`
      INSERT INTO encounter_creature
        (encounter_id, creature_id, display_name, adjustment, level_scale, count, notes, sort_order)
      VALUES (@encounterId, @creatureId, @displayName, @adjustment, @levelScale, @count, @notes, @sortOrder)
    `);
    creatures.forEach((c, index) => insert.run({
      encounterId,
      creatureId: c.creatureId,
      displayName: c.displayName ?? '',
      adjustment: c.adjustment ?? null,
      levelScale: c.levelScale ?? 0,
      count: c.count ?? 1,
      notes: c.notes ?? '',
      sortOrder: c.sortOrder ?? index,
    }));
    db.prepare("UPDATE encounter SET updated_at = datetime('now') WHERE id = ?").run(encounterId);
  });
  write();
  return getEncounter(db, scope, encounterId, campaignId);
}

/**
 * Copy an encounter into another campaign.
 *
 * Both campaign ids go through `campaignFor`, which for a non-GM scope means a
 * copy out of or into someone else's campaign is refused rather than performed
 * in one direction only.
 */
export function copyEncounter(db, scope, encounterId, fromCampaignId, toCampaignId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM copies between campaigns');
  const from = campaignFor(scope, fromCampaignId);
  const to = campaignFor(scope, toCampaignId);

  const source = getEncounter(db, scope, encounterId, from);
  const destination = db.prepare('SELECT id FROM campaign WHERE id = ?').get(to);
  if (!destination) throw new NotFoundError('No such destination campaign');

  const copy = db.transaction(() => {
    const created = createEncounter(db, scope, to, {
      ...source,
      name: source.name,
      sortOrder: source.sortOrder,
    });
    if (source.creatures.length) setCreatures(db, scope, created.id, source.creatures, to);
    return created.id;
  });

  return getEncounter(db, scope, copy(), to);
}
