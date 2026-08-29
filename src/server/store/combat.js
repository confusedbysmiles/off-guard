/**
 * Initiative state.
 *
 * The shared screen reads this, so `visibleCombatants` is the one function that
 * decides what leaves the GM's screen. Hidden combatants are dropped from the
 * list entirely rather than blanked in place: a gap in the numbering, or a row
 * that says "hidden", tells the table there is something there.
 */
import { applyDamage, endOfTurn, applyAutomatic, startOfTurn } from '../../rules/conditions.js';
import { applyPatch } from './characters.js';
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
  visible, hp_numeric AS hpNumeric, revealed, stat_block AS statBlock,
  persistent_damage AS persistentDamage
`;

const hydrate = (row) => (row ? {
  ...row,
  conditions: JSON.parse(row.conditions),
  revealed: JSON.parse(row.revealed),
  persistentDamage: JSON.parse(row.persistentDamage ?? '[]'),
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

/** Every write below goes through here first, so nothing is edited cross-campaign. */
function combatantInScope(db, scope, combatantId, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const row = db.prepare(`
    SELECT c.id AS combatId, b.id AS combatantId
    FROM combatant b JOIN combat c ON c.id = b.combat_id
    WHERE b.id = ? AND c.campaign_id = ?
  `).get(combatantId, campaignId);
  if (!row) throw new NotFoundError('No such combatant');
  return row;
}

const COMBATANT_FIELDS = {
  displayName: 'display_name',
  initiative: 'initiative',
  sortOrder: 'sort_order',
  hpCurrent: 'hp_current',
  hpMax: 'hp_max',
  hpTemp: 'hp_temp',
  dying: 'dying',
  wounded: 'wounded',
  heroPoints: 'hero_points',
  state: 'state',
  notes: 'notes',
  visible: 'visible',
  hpNumeric: 'hp_numeric',
};

const BOOLEAN_FIELDS = new Set(['visible', 'hpNumeric']);

export function getCombatant(db, scope, combatantId, requestedCampaignId = null) {
  combatantInScope(db, scope, combatantId, requestedCampaignId);
  return hydrate(db.prepare(`SELECT ${COMBATANT_COLUMNS} FROM combatant WHERE id = ?`)
    .get(combatantId));
}

export function updateCombatant(db, scope, combatantId, fields, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  combatantInScope(db, scope, combatantId, requestedCampaignId);

  const sets = [];
  const params = { id: combatantId };
  for (const [key, column] of Object.entries(COMBATANT_FIELDS)) {
    if (!(key in fields)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = BOOLEAN_FIELDS.has(key) ? (fields[key] ? 1 : 0) : fields[key];
  }
  for (const key of ['conditions', 'revealed', 'persistentDamage']) {
    if (!(key in fields)) continue;
    sets.push(`${key === 'persistentDamage' ? 'persistent_damage' : key} = @${key}`);
    params[key] = JSON.stringify(fields[key] ?? []);
  }
  if (!sets.length) return getCombatant(db, scope, combatantId, requestedCampaignId);

  db.prepare(`UPDATE combatant SET ${sets.join(', ')} WHERE id = @id`).run(params);

  // A player character's conditions belong to their sheet, which is the copy
  // they are looking at on their phone. Writing them in two places would mean
  // two answers to "am I frightened"; the combatant row is the copy that
  // follows, and `tableView` reads the sheet for a linked character.
  const after = getCombatant(db, scope, combatantId, requestedCampaignId);
  if ('conditions' in fields && after.characterId) {
    applyPatch(db, scope, after.characterId, [{ path: 'conditions', value: fields.conditions ?? [] }],
      { by: 'gm', campaignId: requestedCampaignId });
  }

  return after;
}

export function removeCombatant(db, scope, combatantId, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  combatantInScope(db, scope, combatantId, requestedCampaignId);
  db.prepare('DELETE FROM combatant WHERE id = ?').run(combatantId);
  return { deleted: Number(combatantId) };
}

/**
 * Damage or healing.
 *
 * The arithmetic -- temporary hit points, dying, wounded -- is the rules
 * engine's; this only reads the row, hands it over and writes the result back.
 */
export function damageCombatant(db, scope, combatantId, amount, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  const combatant = getCombatant(db, scope, combatantId, requestedCampaignId);
  const result = applyDamage(combatant, amount);

  db.prepare(`
    UPDATE combatant SET hp_current = ?, hp_temp = ?, dying = ?, wounded = ? WHERE id = ?
  `).run(result.hpCurrent, result.hpTemp, result.dying, result.wounded, combatantId);

  return {
    combatant: getCombatant(db, scope, combatantId, requestedCampaignId),
    notes: result.notes,
    dead: result.dead,
  };
}

/**
 * Order the combatants by initiative, descending.
 *
 * Ties keep the order they already have rather than being broken by a rule the
 * table did not agree to -- the GM drags them, which the brief asks for and
 * which is how it works at a table anyway.
 */
export function sortByInitiative(db, scope, combatId, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  assertCombatInScope(db, scope, combatId, requestedCampaignId);

  const combatants = allCombatants(db, combatId);
  const ordered = [...combatants].sort((a, b) => {
    const left = a.initiative ?? -Infinity;
    const right = b.initiative ?? -Infinity;
    if (left !== right) return right - left;
    return a.sortOrder - b.sortOrder;
  });

  const update = db.prepare('UPDATE combatant SET sort_order = ? WHERE id = ?');
  db.transaction(() => {
    ordered.forEach((combatant, index) => update.run(index, combatant.id));
  })();

  return getActiveCombat(db, scope, requestedCampaignId);
}

export function reorderCombatants(db, scope, combatId, order, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  assertCombatInScope(db, scope, combatId, requestedCampaignId);
  const update = db.prepare('UPDATE combatant SET sort_order = ? WHERE id = ? AND combat_id = ?');
  db.transaction(() => {
    order.forEach((id, index) => update.run(index, id, combatId));
  })();
  return getActiveCombat(db, scope, requestedCampaignId);
}

/**
 * Advance the turn, and say what the boundary asks about.
 *
 * The automatic changes are applied; the prompts are returned for the GM to
 * decide, because a tracker that silently resolves an ambiguous rule is worse
 * than one that asks.
 */
export function advanceTurn(db, scope, combatId, { direction = 1 } = {}, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  assertCombatInScope(db, scope, combatId, requestedCampaignId);

  const combat = db.prepare(`SELECT ${COMBAT_COLUMNS} FROM combat WHERE id = ?`).get(combatId);
  const combatants = allCombatants(db, combatId);
  if (!combatants.length) return { combat: getActiveCombat(db, scope, requestedCampaignId), prompts: [] };

  const ending = combatants[combat.turnIndex] ?? null;
  const prompts = [];

  if (ending && direction > 0) {
    const { automatic, prompts: asked } = endOfTurn(ending);
    if (automatic.length) {
      const conditions = applyAutomatic(ending.conditions, automatic);
      db.prepare('UPDATE combatant SET conditions = ? WHERE id = ?')
        .run(JSON.stringify(conditions), ending.id);
    }
    for (const entry of [...automatic, ...asked]) {
      prompts.push({ ...entry, combatantId: ending.id, name: ending.displayName, when: 'end' });
    }
  }

  let index = combat.turnIndex + direction;
  let round = combat.round;
  if (index >= combatants.length) { index = 0; round += 1; }
  if (index < 0) { index = combatants.length - 1; round = Math.max(1, round - 1); }

  db.prepare('UPDATE combat SET turn_index = ?, round = ? WHERE id = ?').run(index, round, combatId);

  const starting = combatants[index];
  if (starting && direction > 0) {
    for (const entry of startOfTurn(starting).prompts) {
      prompts.push({ ...entry, combatantId: starting.id, name: starting.displayName, when: 'start' });
    }
  }

  return { combat: getActiveCombat(db, scope, requestedCampaignId), prompts };
}

export function endCombat(db, scope, combatId, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM runs initiative');
  assertCombatInScope(db, scope, combatId, requestedCampaignId);
  db.prepare("UPDATE combat SET active = 0, ended_at = datetime('now') WHERE id = ?").run(combatId);
  return { ended: Number(combatId) };
}

export function tableView(db, scope, requestedCampaignId = null) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const combat = getActiveCombat(db, scope, campaignId);
  if (!combat) return { round: null, turnIndex: null, combatants: [] };

  const characters = new Map(
    db.prepare('SELECT id, name, player_name AS playerName, sheet FROM character WHERE campaign_id = ?')
      .all(campaignId).map((c) => [c.id, { ...c, sheet: JSON.parse(c.sheet) }]),
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
        // One source of truth: the sheet for a player, the row for a creature.
        conditions: character ? (character.sheet.conditions ?? []) : c.conditions,
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
