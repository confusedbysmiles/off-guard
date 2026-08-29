/**
 * Initiative state.
 *
 * The shared screen reads this, so `visibleCombatants` is the one function that
 * decides what leaves the GM's screen. Hidden combatants are dropped from the
 * list entirely rather than blanked in place: a gap in the numbering, or a row
 * that says "hidden", tells the table there is something there.
 */
import { assertWritable, campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

const COMBAT_COLUMNS = `
  id, campaign_id AS campaignId, encounter_id AS encounterId, name, round,
  turn_index AS turnIndex, active, started_at AS startedAt, ended_at AS endedAt
`;

const COMBATANT_COLUMNS = `
  id, combat_id AS combatId, character_id AS characterId, creature_id AS creatureId,
  display_name AS displayName, initiative, sort_order AS sortOrder,
  hp_current AS hpCurrent, hp_max AS hpMax, hp_temp AS hpTemp,
  conditions, dying, wounded, hero_points AS heroPoints, state, notes,
  visible, hp_numeric AS hpNumeric, revealed, stat_block AS statBlock
`;

const hydrate = (row) => (row ? {
  ...row,
  conditions: JSON.parse(row.conditions),
  revealed: JSON.parse(row.revealed),
  statBlock: row.statBlock ? JSON.parse(row.statBlock) : null,
  visible: Boolean(row.visible),
  hpNumeric: Boolean(row.hpNumeric),
} : row);

export function getActiveCombat(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const combat = db.prepare(`
    SELECT ${COMBAT_COLUMNS} FROM combat WHERE campaign_id = ? AND active = 1
  `).get(campaignId);
  if (!combat) return null;
  return { ...combat, combatants: allCombatants(db, combat.id) };
}

function allCombatants(db, combatId) {
  return db.prepare(`
    SELECT ${COMBATANT_COLUMNS} FROM combatant WHERE combat_id = ? ORDER BY sort_order, id
  `).all(combatId).map(hydrate);
}

export function startCombat(db, scope, requestedCampaignId, fields = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const begin = db.transaction(() => {
    db.prepare(`
      UPDATE combat SET active = 0, ended_at = datetime('now')
      WHERE campaign_id = ? AND active = 1
    `).run(campaignId);
    return db.prepare(`
      INSERT INTO combat (campaign_id, encounter_id, name) VALUES (?, ?, ?)
    `).run(campaignId, fields.encounterId ?? null, fields.name ?? '').lastInsertRowid;
  });
  begin();
  return getActiveCombat(db, scope, campaignId);
}

export function addCombatant(db, scope, combatId, fields, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  // The campaign id is required rather than inferred from the combat row: the
  // GM reaches every campaign, so inferring it would make a combat id from the
  // wrong campaign succeed silently.
  assertCombatInScope(db, scope, combatId, requestedCampaignId);
  const info = db.prepare(`
    INSERT INTO combatant
      (combat_id, character_id, creature_id, display_name, initiative, sort_order,
       hp_current, hp_max, hp_temp, visible, hp_numeric, stat_block)
    VALUES (@combatId, @characterId, @creatureId, @displayName, @initiative, @sortOrder,
            @hpCurrent, @hpMax, @hpTemp, @visible, @hpNumeric, @statBlock)
  `).run({
    combatId,
    characterId: fields.characterId ?? null,
    creatureId: fields.creatureId ?? null,
    displayName: fields.displayName ?? '',
    initiative: fields.initiative ?? null,
    sortOrder: fields.sortOrder ?? 0,
    hpCurrent: fields.hpCurrent ?? null,
    hpMax: fields.hpMax ?? null,
    hpTemp: fields.hpTemp ?? 0,
    visible: fields.visible === false ? 0 : 1,
    hpNumeric: fields.hpNumeric ? 1 : 0,
    statBlock: fields.statBlock ? JSON.stringify(fields.statBlock) : null,
  });
  return hydrate(db.prepare(`SELECT ${COMBATANT_COLUMNS} FROM combatant WHERE id = ?`)
    .get(info.lastInsertRowid));
}

/**
 * A combat id from the client is checked against the scope's campaign before
 * any write touches it. Without this, a combatant id would be enough to write
 * into another campaign's fight.
 */
export function assertCombatInScope(db, scope, combatId, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const row = db.prepare('SELECT id FROM combat WHERE id = ? AND campaign_id = ?')
    .get(combatId, campaignId);
  if (!row) throw new NotFoundError('No such combat');
  return Number(combatId);
}

/**
 * What the shared screen may show.
 *
 * Health becomes a descriptor unless the GM flipped that combatant to numeric,
 * and hidden rows are absent rather than redacted.
 */
export const HEALTH_DESCRIPTORS = [
  'Unharmed', 'Lightly Injured', 'Moderately Injured', 'Heavily Injured', 'Near Death',
];

export function healthDescriptor(current, max) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
  const fraction = Math.max(0, current) / max;
  if (fraction >= 1) return HEALTH_DESCRIPTORS[0];
  if (fraction > 0.75) return HEALTH_DESCRIPTORS[1];
  if (fraction > 0.5) return HEALTH_DESCRIPTORS[2];
  if (fraction > 0.25) return HEALTH_DESCRIPTORS[3];
  return HEALTH_DESCRIPTORS[4];
}

export function tableView(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const combat = getActiveCombat(db, scope, campaignId);
  if (!combat) return { round: null, turnIndex: null, combatants: [] };

  const characters = new Map(
    db.prepare('SELECT id, name, player_name AS playerName FROM character WHERE campaign_id = ?')
      .all(campaignId).map((c) => [c.id, c]),
  );

  const combatants = combat.combatants
    .filter((c) => c.visible)
    .map((c) => {
      const character = c.characterId ? characters.get(c.characterId) : null;
      const base = {
        id: c.id,
        isPlayer: Boolean(character),
        name: character ? character.name : c.displayName,
        playerName: character ? character.playerName : null,
        conditions: c.conditions,
        revealed: c.revealed,
        state: c.state,
      };
      // A player character shows a real bar; the party knows their own numbers.
      if (character) {
        return { ...base, hpCurrent: c.hpCurrent, hpMax: c.hpMax, hpTemp: c.hpTemp };
      }
      if (c.hpNumeric) {
        return { ...base, hpCurrent: c.hpCurrent, hpMax: c.hpMax, hpTemp: c.hpTemp };
      }
      return { ...base, health: healthDescriptor(c.hpCurrent, c.hpMax) };
    });

  // The index is recomputed against the filtered list so a hidden combatant
  // ahead of the current turn cannot be inferred from a jump in the numbering.
  const activeId = combat.combatants[combat.turnIndex]?.id ?? null;
  return {
    round: combat.round,
    activeId: combatants.some((c) => c.id === activeId) ? activeId : null,
    combatants,
  };
}
