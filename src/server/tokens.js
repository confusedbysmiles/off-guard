/**
 * Access tokens.
 *
 * 128 bits of randomness rendered in Crockford base32, which drops I, L, O and
 * U so a token can be read aloud across a table without ambiguity. 128 bits is
 * 26 characters at 5 bits each, with the last character carrying 3 bits.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

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
 * What may be written to a log. Never the token: logs get shipped, pasted into
 * issues and read over shoulders.
 */
export function tokenFingerprint(token) {
  const t = String(token ?? '');
  return t.length >= 4 ? `${t.slice(0, 4)}...` : '...';
}
