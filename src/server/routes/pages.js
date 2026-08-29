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
import { recordFailure } from '../store/tokens.js';

export async function registerPageRoutes(app, { publicDir }) {
  const shells = new Map();
  const shell = (name) => {
    if (!shells.has(name)) shells.set(name, readFileSync(resolve(publicDir, name), 'utf8'));
    return shells.get(name);
  };

  const page = (kind, file) => async (request, reply) => {
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

    reply.type('text/html');
    return shell(file);
  };

  app.get('/c/:token', { onRequest: app.rateLimit() }, page('character', 'sheet.html'));
  app.get('/gm/:token', { onRequest: app.rateLimit() }, page('gm', 'gm.html'));
}
