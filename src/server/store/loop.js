/**
 * Loop runs.
 *
 * Thin: the transitions live in `src/shared/loop.js` because the dashboard
 * applies them too, and duplicating "what a reset keeps" on the server would
 * give the two sides two chances to disagree about it.
 *
 * What this module owns is persistence and scope. The console writes whole
 * states rather than patches -- a nine-slot clock is small, the GM is the only
 * writer, and a partial update model would buy nothing but a merge problem.
 */
import {
  assertWritable, campaignFor, InvalidError, isGm, NotFoundError, ScopeError,
} from '../scope.js';
import { clockFace, eventAt, fromRow, toRow } from '../../shared/loop.js';
import { adventureById } from '../../shared/adventures/index.js';

const COLUMNS = `
  id, campaign_id AS campaignId, adventure_id AS adventureId, title,
  loop, slot,
  influence_points AS influencePoints, influence_high_water AS influenceHighWater,
  detail, created_at AS createdAt, updated_at AS updatedAt
`;

/** Adventure ids come from the client, so they are checked rather than trusted. */
function asAdventureId(value) {
  const text = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(text)) {
    throw new InvalidError('An adventure id is lowercase letters, digits and hyphens');
  }
  return text;
}

const rowFor = (db, campaignId, adventureId) => db.prepare(`
  SELECT ${COLUMNS} FROM loop_run WHERE campaign_id = ? AND adventure_id = ?
`).get(campaignId, adventureId);

/** The run as the console wants it, or null when this campaign has never run it. */
export function getRun(db, scope, requestedCampaignId, adventureId) {
  if (!isGm(scope)) throw new ScopeError('Only the GM reads the loop console');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const row = rowFor(db, campaignId, asAdventureId(adventureId));
  return row ? { ...row, state: fromRow(row) } : null;
}

export function listRuns(db, scope, requestedCampaignId = null) {
  if (!isGm(scope)) throw new ScopeError('Only the GM reads the loop console');
  const campaignId = campaignFor(scope, requestedCampaignId);
  return db.prepare(`
    SELECT ${COLUMNS} FROM loop_run WHERE campaign_id = ? ORDER BY updated_at DESC
  `).all(campaignId).map((row) => ({ ...row, state: fromRow(row) }));
}

/**
 * Write a run, creating it if this campaign has not run this adventure before.
 *
 * Upsert rather than create-then-update: the console's first save is
 * indistinguishable from its hundredth, and making the client track which one
 * it is would be state the client should not have to keep.
 */
export function saveRun(db, scope, requestedCampaignId, adventureId, { state, title } = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the loop console');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const id = asAdventureId(adventureId);
  if (!state || typeof state !== 'object') throw new InvalidError('A loop run needs a state');

  const row = toRow(state);
  db.prepare(`
    INSERT INTO loop_run (campaign_id, adventure_id, title, loop, slot,
                          influence_points, influence_high_water, detail)
    VALUES (@campaignId, @adventureId, @title, @loop, @slot,
            @influencePoints, @influenceHighWater, @detail)
    ON CONFLICT (campaign_id, adventure_id) DO UPDATE SET
      title = @title,
      loop = @loop,
      slot = @slot,
      influence_points = @influencePoints,
      influence_high_water = @influenceHighWater,
      detail = @detail,
      updated_at = datetime('now')
  `).run({
    campaignId,
    adventureId: id,
    title: String(title ?? '').slice(0, 200),
    loop: Math.max(1, Number(row.loop) || 1),
    slot: Math.max(1, Number(row.slot) || 1),
    influencePoints: Math.max(0, Number(row.influencePoints) || 0),
    influenceHighWater: Math.max(0, Number(row.influenceHighWater) || 0),
    detail: JSON.stringify(row.detail ?? {}),
  });

  const saved = rowFor(db, campaignId, id);
  return { ...saved, state: fromRow(saved) };
}

/**
 * Throw the run away and start the adventure over.
 *
 * Returned whole so the dashboard can offer an undo rather than a warning,
 * which is the same bargain the session log makes.
 */
export function deleteRun(db, scope, requestedCampaignId, adventureId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM writes the loop console');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const id = asAdventureId(adventureId);
  const existing = rowFor(db, campaignId, id);
  if (!existing) throw new NotFoundError('No such loop run');
  db.prepare('DELETE FROM loop_run WHERE campaign_id = ? AND adventure_id = ?').run(campaignId, id);
  return { deleted: { ...existing, state: fromRow(existing) } };
}

/**
 * The loop, as the room may see it.
 *
 * Everything on this screen is resolved here rather than sent as state for the
 * page to interpret, because the shared screen's rule is that the payload
 * contains only what players may see -- the same reason a secret roll is
 * dropped from it rather than sent with a flag. The adventure holds discovery
 * DCs, solutions and the faults nobody has found yet; none of that leaves this
 * function, so a player who opens the shared screen on their own phone and
 * reads it finds the clock and their own notes.
 *
 * What survives:
 *
 *   - the clock, which is the point of the screen
 *   - which loop this is, because the party is counting
 *   - the event on this minute, which has just happened in front of everyone
 *   - the faults the party *knows*, by name, and whether each is fixed
 *   - influence, which the party is told as it is earned
 *
 * A fault nobody has discovered is not listed, and no count of the undiscovered
 * is given either: "two of five" tells the table how much is left to find.
 *
 * `null` when this campaign has never run a looping adventure, which is almost
 * every campaign -- the shared screen then looks exactly as it did before.
 */
const pick = (object, keys) => (object
  ? Object.fromEntries(keys.flatMap((key) => (key in object ? [[key, object[key]]] : [])))
  : null);

export function runForRoom(db, campaignId) {
  const row = db.prepare(`
    SELECT ${COLUMNS} FROM loop_run WHERE campaign_id = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(campaignId);
  if (!row) return null;

  const adventure = adventureById(row.adventureId);
  if (!adventure) return null;      // a run whose adventure has been removed

  const state = fromRow(row);
  const known = (adventure.faults ?? [])
    .filter((fault) => state.faults?.[fault.id]?.known)
    .map((fault) => ({
      id: fault.id,
      n: fault.n ?? null,
      name: fault.name,
      fixed: Boolean(state.faults[fault.id]?.fixed),
    }));

  return {
    adventureId: row.adventureId,
    title: row.title || adventure.title,
    loop: state.loop,
    slot: state.slot,
    slots: adventure.loop?.slots ?? null,
    clock: clockFace(adventure, state.slot),
    // Label and tone only. An event's `note` is written to the GM -- "every
    // loop, no exceptions" is a fact about the adventure's structure, not
    // something the room has just watched happen.
    event: pick(eventAt(adventure, state.slot), ['label', 'tone']),
    known,
    influence: {
      points: state.influence?.points ?? 0,
      max: adventure.influence?.max ?? null,
    },
  };
}
