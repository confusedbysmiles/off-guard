/**
 * Security headers and the token-guessing defence.
 *
 * The access model is "the URL is the credential", which puts three specific
 * obligations on the server, all of them handled here:
 *
 *   1. The token must not leak sideways. No Referer, no indexing, no token in
 *      a page title or an og: tag (that one is the templates' job, and there
 *      are no og: tags at all).
 *   2. Guessing must be expensive. 128 bits is not guessable, but a rate limit
 *      and a log turn "unguessable in theory" into "visibly not happening".
 *   3. Injected script must not be able to read the URL and post it out. Hence
 *      a Content-Security-Policy with no unsafe-inline and no remote origins.
 */
import { tokenFingerprint } from './tokens.js';

/**
 * No unsafe-inline anywhere. There is no build step, so every stylesheet and
 * script is an external file and this costs nothing; the one unavoidable inline
 * case (a bootstrap value) uses a per-response nonce.
 */
export function contentSecurityPolicy(nonce) {
  return [
    "default-src 'none'",
    "script-src 'self'" + (nonce ? ` 'nonce-${nonce}'` : ''),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    // The API and the SSE stream, and nothing else. No telemetry endpoint can
    // be added by accident.
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join('; ');
}

export function securityHeaders(reply, { nonce = null } = {}) {
  reply.header('Content-Security-Policy', contentSecurityPolicy(nonce));
  // The single most important header here: without it, every outbound link
  // from a sheet would carry the token in the Referer.
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  return reply;
}

export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/**
 * What a request may say about itself in a log line.
 *
 * The token lives in the path, so the path cannot be logged as-is. Fastify's
 * own request logging is disabled in `app.js` for the same reason.
 */
export function safeRequestLog(request, token) {
  return {
    method: request.method,
    route: request.routeOptions?.url ?? '(unrouted)',
    ip: request.ip,
    token: tokenFingerprint(token),
  };
}
