/**
 * The devices a link has been opened from.
 *
 * Written on every request that arrives with a good token, read by the GM's
 * links panel, and consulted on every request to a link that has been locked.
 * The hot path is `see`, so it is two indexed statements and no transaction:
 * an upsert on `(token_id, device_hash)` and nothing else.
 */
import { isGm, NotFoundError, ScopeError, assertWritable } from '../scope.js';
import { deviceHash } from '../devices.js';

/**
 * Record that this device has used this link, and say whether it had before.
 *
 * The answer is what enforcement is built on, so it is computed from the write
 * rather than guessed at: an insert that changed a row is a device that was
 * already there, and one that inserted is new.
 */
export function see(db, tokenId, secret, { label = '' } = {}) {
  if (!secret) return { known: false, recorded: false };
  const hash = deviceHash(tokenId, secret);

  const existing = db.prepare(
    'SELECT id FROM token_device WHERE token_id = ? AND device_hash = ?',
  ).get(tokenId, hash);

  if (existing) {
    db.prepare("UPDATE token_device SET last_seen_at = datetime('now') WHERE id = ?")
      .run(existing.id);
    return { known: true, recorded: true };
  }

  db.prepare(`
    INSERT INTO token_device (token_id, device_hash, label) VALUES (?, ?, ?)
  `).run(tokenId, hash, String(label ?? '').slice(0, 60));
  return { known: false, recorded: true };
}

/** Whether a locked link should let this device through. */
export function knows(db, tokenId, secret) {
  if (!secret) return false;
  return Boolean(db.prepare(
    'SELECT 1 FROM token_device WHERE token_id = ? AND device_hash = ?',
  ).get(tokenId, deviceHash(tokenId, secret)));
}

const COLUMNS = `
  id, token_id AS tokenId, label,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
`;

/** Never the hash: it is a credential's digest and the panel has no use for it. */
export function listDevices(db, tokenId) {
  return db.prepare(`
    SELECT ${COLUMNS} FROM token_device WHERE token_id = ? ORDER BY last_seen_at DESC
  `).all(tokenId);
}

/**
 * Forget one device.
 *
 * On an unlocked link this is housekeeping -- a row for a phone somebody no
 * longer owns. On a locked one it is a revocation, and the next request from
 * that device is refused.
 */
export function forgetDevice(db, scope, tokenId, deviceId) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM manages links');
  const info = db.prepare('DELETE FROM token_device WHERE id = ? AND token_id = ?')
    .run(Number(deviceId), Number(tokenId));
  if (!info.changes) throw new NotFoundError('No such device');
  return { forgotten: true };
}

/**
 * Turn enforcement on or off for one link.
 *
 * Locking a link that no device has ever used would be locking it against
 * everybody, including the person it was minted for, so it is refused with a
 * reason rather than accepted into a state nobody wants.
 */
export function setLocked(db, scope, tokenId, locked) {
  assertWritable(scope);
  if (!isGm(scope)) throw new ScopeError('Only the GM manages links');

  const token = db.prepare('SELECT id FROM token WHERE id = ? AND revoked_at IS NULL')
    .get(Number(tokenId));
  if (!token) throw new NotFoundError('No such link');

  if (locked && !listDevices(db, Number(tokenId)).length) {
    throw new ScopeError('Nothing has opened this link yet, so locking it would lock everybody out.');
  }

  db.prepare(`UPDATE token SET locked_at = ${locked ? "datetime('now')" : 'NULL'} WHERE id = ?`)
    .run(Number(tokenId));
  return { locked: Boolean(locked) };
}
