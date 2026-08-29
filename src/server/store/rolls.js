/**
 * The dice log.
 *
 * Rolling happens here rather than in the browser for the same reason
 * initiative does: the shared screen has to be shown the same numbers the GM
 * saw, and the only way to guarantee that is for one process to roll once.
 *
 * Secrecy is enforced on the way out, not on the way in. `visibleRolls` is the
 * only function the shared screen's payload is built from, and a secret roll is
 * dropped from the list entirely rather than blanked -- the same rule hidden
 * combatants follow, and for the same reason: a row that says "secret" tells
 * the table there was a roll.
 */
import { rollDice, halve, double } from '../../rules/dice.js';
import { assertWritable, campaignFor, isGm, NotFoundError, ScopeError } from '../scope.js';

const COLUMNS = `
  id, campaign_id AS campaignId, label, expression, detail, total,
  secret, derived_from AS derivedFrom, derivation, rolled_at AS rolledAt
`;

/** How many rolls a campaign keeps. A session is a few dozen; this is generous. */
export const LOG_LIMIT = 200;

/** What the shared screen shows. Long enough to read a hit and its damage. */
export const BROADCAST_COUNT = 4;

const hydrate = (row) => (row ? {
  ...row,
  detail: JSON.parse(row.detail),
  secret: Boolean(row.secret),
} : row);

export function listRolls(db, scope, requestedCampaignId = null, { limit = 50 } = {}) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  if (!isGm(scope)) throw new ScopeError('Only the GM sees the whole log');
  return db.prepare(`
    SELECT ${COLUMNS} FROM roll WHERE campaign_id = ? ORDER BY id DESC LIMIT ?
  `).all(campaignId, Math.min(Number(limit) || 50, LOG_LIMIT)).map(hydrate);
}

/**
 * The rolls the table may see.
 *
 * Takes a campaign id it has already resolved, because it is called from
 * `tableView`, which resolved it against the scope one line earlier.
 */
export function visibleRolls(db, campaignId, { limit = BROADCAST_COUNT } = {}) {
  return db.prepare(`
    SELECT ${COLUMNS} FROM roll
    WHERE campaign_id = ? AND secret = 0
    ORDER BY id DESC LIMIT ?
  `).all(campaignId, limit).map(hydrate).map((roll) => ({
    id: roll.id,
    label: roll.label,
    expression: roll.expression,
    total: roll.total,
    derivation: roll.derivation,
    rolledAt: roll.rolledAt,
  }));
}

function trim(db, campaignId) {
  db.prepare(`
    DELETE FROM roll
    WHERE campaign_id = @campaignId
      AND id NOT IN (
        SELECT id FROM roll WHERE campaign_id = @campaignId ORDER BY id DESC LIMIT @keep
      )
  `).run({ campaignId, keep: LOG_LIMIT });
}

function insert(db, campaignId, fields) {
  const info = db.prepare(`
    INSERT INTO roll (campaign_id, label, expression, detail, total, secret, derived_from, derivation)
    VALUES (@campaignId, @label, @expression, @detail, @total, @secret, @derivedFrom, @derivation)
  `).run({
    campaignId,
    label: fields.label ?? '',
    expression: fields.expression,
    detail: JSON.stringify(fields.detail ?? {}),
    total: fields.total,
    secret: fields.secret ? 1 : 0,
    derivedFrom: fields.derivedFrom ?? null,
    derivation: fields.derivation ?? null,
  });
  trim(db, campaignId);
  return hydrate(db.prepare(`SELECT ${COLUMNS} FROM roll WHERE id = ?`).get(info.lastInsertRowid));
}

/**
 * Roll an expression and log it.
 *
 * `random` is injectable so a test can pin the dice; nothing else passes it.
 */
export function roll(db, scope, requestedCampaignId, { expression, label = '', secret = false },
  { random } = {}) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM rolls from here');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const result = rollDice(expression, random ? { random } : {});
  return insert(db, campaignId, {
    label: String(label).slice(0, 120),
    expression: result.expression,
    detail: result,
    total: result.total,
    secret,
  });
}

/**
 * Halve or double a roll that already happened.
 *
 * The arithmetic is the rules engine's -- halving rounds down, doubling doubles
 * the total rather than each die -- and the new entry inherits the secrecy of
 * the roll it came from. A doubled total that appeared on the shared screen
 * while its secret parent did not would give the parent away.
 */
export function derive(db, scope, requestedCampaignId, rollId, derivation) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM rolls from here');
  const campaignId = campaignFor(scope, requestedCampaignId);

  const parent = hydrate(db.prepare(`
    SELECT ${COLUMNS} FROM roll WHERE id = ? AND campaign_id = ?
  `).get(rollId, campaignId));
  if (!parent) throw new NotFoundError('No such roll');
  if (derivation !== 'half' && derivation !== 'double') {
    throw new ScopeError('A roll can be halved or doubled, nothing else');
  }

  const total = derivation === 'half' ? halve(parent.total) : double(parent.total);
  return insert(db, campaignId, {
    label: parent.label,
    expression: parent.expression,
    detail: { from: parent.total, derivation },
    total,
    secret: parent.secret,
    derivedFrom: parent.id,
    derivation,
  });
}

/** Clear the log. Undo is the GM's own memory here; the log is not the record. */
export function clearRolls(db, scope, requestedCampaignId = null) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM clears the log');
  const campaignId = campaignFor(scope, requestedCampaignId);
  const info = db.prepare('DELETE FROM roll WHERE campaign_id = ?').run(campaignId);
  return { cleared: info.changes };
}
