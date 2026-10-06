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

  // A browser with no cookie gets one. The secret is minted here rather than
  // taken from anything the client sent, so a device cannot choose its own
  // identity and collide with one already on the list.
  const issued = secret ? null : mintDeviceSecret();
  see(db, scope.tokenId, secret ?? issued, {
    label: labelFor(request.headers?.['user-agent']),
  });

  if (issued) {
    reply.header('set-cookie', deviceCookie(issued, {
      secure: isSecureRequest(request),
      path: mount || '/',
    }));
  }

  return { allowed: true };
}
