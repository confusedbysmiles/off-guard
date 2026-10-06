/**
 * The HTML shells.
 *
 * Served by named routes rather than as static files, so that a wrong or
 * revoked link gets the same 404 as a wrong API call instead of rendering an
 * empty sheet that looks like a bug. The token never appears in the markup:
 * the page reads it from `location.pathname`, which keeps it out of the title,
 * out of any meta tag, and out of anything that could be copied by accident.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveScope } from '../scope.js';
import { isWellFormed, normalizeToken, tokenFingerprint } from '../tokens.js';
import { failureCount, recordFailure } from '../store/tokens.js';
import { gate } from '../device-gate.js';

export async function registerPageRoutes(app, { publicDir, mount = '' }) {
  const shells = new Map();
  const shell = (name) => {
    if (!shells.has(name)) shells.set(name, readFileSync(resolve(publicDir, name), 'utf8'));
    return shells.get(name);
  };

  const page = (kind, file) => async (request, reply) => {
    // The same failure counter the API gate uses: a page load with a bad token
    // is exactly as much of a guess as an API call with one.
    if (failureCount(app.db, request.ip, { minutes: 5 }) >= 15) {
      reply.status(429).type('text/html');
      return shell('not-found.html');
    }

    const token = normalizeToken(request.params.token);
    const scope = isWellFormed(token) ? resolveScope(app.db, token) : null;

    if (!scope || scope.kind !== kind) {
      recordFailure(app.db, {
        ip: request.ip,
        path: `page:${kind}`,
        tokenPrefix: tokenFingerprint(token),
      });
      request.log.warn({ ip: request.ip, kind, token: tokenFingerprint(token) }, 'access denied');
      reply.status(404).type('text/html');
      return shell('not-found.html');
    }

    /**
     * The device, after the token.
     *
     * A locked link gets its own page rather than the 404 a wrong link gets.
     * The 404 exists so a wrong token cannot be distinguished from a wrong
     * URL; this token is right, and whoever holds it already knows that, so
     * the only thing a 404 would hide here is the one sentence that tells a
     * player what to do next.
     */
    if (!gate(app.db, { request, reply, scope, mount }).allowed) {
      reply.status(403).type('text/html');
      return shell('locked.html');
    }

    reply.type('text/html');
    return shell(file);
  };

  app.get('/c/:token', { onRequest: app.rateLimit() }, page('character', 'sheet.html'));
  // The builder is the same character behind the same token, on its own page:
  // building and playing are different postures and the sheet is the one that
  // has to stay usable one-handed at the table.
  app.get('/build/:token', { onRequest: app.rateLimit() }, page('character', 'build.html'));
  app.get('/gm/:token', { onRequest: app.rateLimit() }, page('gm', 'gm.html'));
  app.get('/table/:token', { onRequest: app.rateLimit() }, page('table', 'table.html'));
}
