/**
 * The device a link is being opened from.
 *
 * A second factor, never a replacement for the first. The token in the path
 * stays exactly as load-bearing as it was, and this is a cookie that says
 * "whoever is asking has opened this link before". The order matters: a secret
 * path is also what makes this application immune to cross-site request
 * forgery, because a page that cannot address a request cannot forge one. A
 * cookie, by contrast, is sent by the browser to anybody who asks for it. Swap
 * them round and the application gets weaker while looking stronger.
 *
 * No dependency for the cookie. One name, one value, no attributes to read
 * back -- `@fastify/cookie` is a fine library and this is nine lines.
 */
import { createHash } from 'node:crypto';

import { mintToken } from './tokens.js';

export const COOKIE = 'og_device';

/** Two years. A table plays for longer than that and a cookie should outlast a season. */
const MAX_AGE = 60 * 60 * 24 * 730;

/** The device secret this browser already has, if it has one. */
export function deviceSecretFrom(request) {
  const header = String(request?.headers?.cookie ?? '');
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== COOKIE) continue;
    return part.slice(at + 1).trim();
  }
  return null;
}

/** A fresh one. The same 128 bits a token gets, from the same generator. */
export const mintDeviceSecret = mintToken;

/**
 * The value stored against a link.
 *
 * Salted with the token's own id, which is the whole privacy design: one
 * browser that opens two links produces two unrelatable rows, so the table
 * cannot answer "which links has this person opened". The feature never needs
 * that question answered and the GM was never offered an answer to it.
 */
export const deviceHash = (tokenId, secret) => createHash('sha256')
  .update(`${Number(tokenId)}:${String(secret ?? '')}`, 'utf8')
  .digest('hex');

/**
 * Set-Cookie, for a browser that did not have one.
 *
 * `HttpOnly` because no script has any business reading it -- and because the
 * content security policy already forbids the scripts that would try.
 * `SameSite=Lax` so a link followed from a chat application still arrives with
 * its cookie, which is how every one of these links is opened.
 */
export function deviceCookie(secret, { secure = true, path = '/' } = {}) {
  return [
    `${COOKIE}=${secret}`,
    `Path=${path || '/'}`,
    `Max-Age=${MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

/**
 * Whether this request arrived over TLS.
 *
 * Cloudflare terminates it, so the socket here is plain HTTP and the only
 * honest answer is the forwarded header -- which is trustworthy because
 * `trustProxy` is on and nothing but the tunnel can reach the port. A `Secure`
 * cookie set over plain HTTP is simply discarded, which would make the feature
 * silently do nothing on a development server.
 */
export function isSecureRequest(request) {
  const forwarded = String(request?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim();
  if (forwarded) return forwarded === 'https';
  return request?.protocol === 'https';
}

const PLATFORMS = [
  [/iPhone/i, 'iPhone'], [/iPad/i, 'iPad'], [/Android/i, 'Android'],
  [/Macintosh|Mac OS X/i, 'Mac'], [/Windows/i, 'Windows'],
  [/CrOS/i, 'Chromebook'], [/Linux/i, 'Linux'],
];

// Order matters: every one of these says "Safari" somewhere, and most say
// "Chrome" too.
const BROWSERS = [
  [/Edg\//i, 'Edge'], [/OPR\/|Opera/i, 'Opera'], [/Firefox\//i, 'Firefox'],
  [/Chrome\/|CriOS/i, 'Chrome'], [/Safari\//i, 'Safari'],
];

/**
 * What can honestly be said about a device, and nothing more.
 *
 * "iPhone · Safari" is enough for a GM to tell one row from another, which is
 * the entire job. The agent string itself is not kept: it is long, it is
 * identifying, and storing it would be storing something about a player that
 * the sheet does not need.
 */
export function labelFor(userAgent) {
  const agent = String(userAgent ?? '');

  /**
   * Things that are not browsers, named as what they are.
   *
   * The MCP server identifies itself honestly, and the GM should be able to
   * see at a glance that something which is not a browser has opened a
   * player's link. "Unknown device" would be true and would hide the one fact
   * worth noticing.
   */
  if (/Off-Guard MCP/i.test(agent)) return 'MCP client';
  const platform = PLATFORMS.find(([pattern]) => pattern.test(agent))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  return [platform, browser].filter(Boolean).join(' · ') || 'Unknown device';
}
