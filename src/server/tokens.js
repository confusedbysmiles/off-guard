/**
 * Access tokens.
 *
 * 128 bits of randomness rendered in Crockford base32, which drops I, L, O and
 * U so a token can be read aloud across a table without ambiguity. 128 bits is
 * 26 characters at 5 bits each, with the last character carrying 3 bits.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TOKEN_LENGTH = 26;
const TOKEN_PATTERN = new RegExp(`^[${ALPHABET}]{${TOKEN_LENGTH}}$`);

/** A fresh 128-bit token. */
export function mintToken() {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Normalize what a person typed. Crockford's own rules: case-insensitive, and
 * the excluded letters map to the digits they resemble, so a link copied by
 * hand from a phone screen still works.
 */
export function normalizeToken(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '');
}

export function isWellFormed(token) {
  return TOKEN_PATTERN.test(token);
}

/**
 * Constant-time comparison, so a timing difference cannot be used to walk a
 * token character by character. The database lookup is indexed and therefore
 * not constant time; this guards the comparisons application code does.
 */
export function tokensEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The value stored in the database.
 *
 * A plain SHA-256, deliberately, and not bcrypt or argon2. Those exist to make
 * guessing expensive when the secret is a human-chosen password with maybe 30
 * bits of entropy behind it. A token here is 128 bits from `randomBytes`, so an
 * attacker holding the database has nothing to guess at: there is no dictionary,
 * no reuse, and no shortcut. A slow hash would buy nothing and would cost a
 * measurable delay on every single request, including every SSE reconnect.
 *
 * What hashing does buy is that a leaked database file -- a backup, a copied
 * WAL, a support dump -- no longer contains working links.
 *
 * The lookup is by indexed equality on the hash rather than a scan with a
 * constant-time compare. An index probe is not constant time, but the value
 * being probed is a 256-bit digest of a 128-bit secret; there is no practical
 * way to walk that with timing. `tokensEqual` remains for comparisons the
 * application makes itself.
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

/**
 * What may be written to a log. Never the token: logs get shipped, pasted into
 * issues and read over shoulders.
 */
export function tokenFingerprint(token) {
  const t = String(token ?? '');
  return t.length >= 4 ? `${t.slice(0, 4)}...` : '...';
}
