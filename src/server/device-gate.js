/**
 * The device check, in one place.
 *
 * Both doors use it: the API hook in `app.js` and the page routes in
 * `routes/pages.js`. One function, because two copies of an access rule is how
 * a gap appears between them -- and the gap that matters here would be a
 * locked link that refuses the API and serves the page, or the reverse.
 *
 * It runs only after the token has been resolved. Nothing about a device grants
 * access on its own; this can refuse a request that the token would have
 * allowed, and can never allow one the token would not.
 */
import {
  deviceCookie, deviceSecretFrom, isSecureRequest, labelFor, mintDeviceSecret,
} from './devices.js';
import { knows, see } from './store/devices.js';

/**
 * @returns {{allowed: boolean}} and, when allowed, sets the cookie on the reply
 *   if the browser did not already have one.
 */
export function gate(db, { request, reply, scope, mount = '' }) {
  const secret = deviceSecretFrom(request);

  /**
   * A locked link, from a device it has never seen.
   *
   * Refused before anything is written, which is the point: if a refused
   * request still recorded its device, locking a link would mean nothing --
   * anybody holding it could knock once, be turned away, and walk in.
   */
  if (scope.lockedAt && !knows(db, scope.tokenId, secret)) {
    request.log.warn(
      { kind: scope.kind, tokenId: scope.tokenId },
      'locked link refused an unknown device',
    );
    return { allowed: false };
  }

  /**
   * A browser with no cookie gets one, and is not written down for it.
   *
   * A device is a browser that came back. Recording the first sight of one
   * recorded everything that ever touched the URL: a chat client fetching a
   * link preview, a crawler, a private window, curl. None of those keep the
   * cookie, so every request was a fresh row -- a player's link collected a
   * hundred and sixty "devices" that were nothing of the kind, which made the
   * list unreadable and made locking to it worse the longer the link had been
   * in a group chat.
   *
   * So the cookie is handed out on the first request and the row is written on
   * the second, when the browser proves it kept it. Nothing that discards
   * cookies is ever counted, and a real browser is counted within milliseconds
   * -- the page issues the cookie and the sheet's first API call carries it
   * back. A browser that already has one from another link is counted on its
   * first request here, because it already has the thing being asked for.
   *
   * The secret is minted here rather than taken from anything the client sent,
   * so a device cannot choose its own identity and collide with one already on
   * the list.
   */
  const issued = secret ? null : mintDeviceSecret();
  if (secret) {
    see(db, scope.tokenId, secret, {
      label: labelFor(request.headers?.['user-agent']),
    });
  }

  if (issued) {
    reply.header('set-cookie', deviceCookie(issued, {
      secure: isSecureRequest(request),
      path: mount || '/',
    }));
  }

  return { allowed: true };
}
