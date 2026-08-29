/**
 * The Fastify application.
 *
 * Route shape mirrors the access model exactly, so the scope of a request is
 * visible in its URL and cannot be widened by a body field:
 *
 *   /api/gm/:token/...         every campaign, one token
 *   /api/c/:token/...          one character in one campaign
 *   /api/table/:token          one campaign's shared screen, read-only
 *
 * Each of the three registers its own `onRequest` hook that resolves the token
 * and refuses anything of the wrong kind, so a character token cannot reach a
 * GM route even if the route forgot to check.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { resolveScope, ScopeError, NotFoundError } from './scope.js';
import { isWellFormed, normalizeToken, tokenFingerprint } from './tokens.js';
import { recordFailure, touchToken } from './store/tokens.js';
import { ROBOTS_TXT, securityHeaders } from './security.js';
import { registerGmRoutes } from './routes/gm.js';
import { registerCharacterRoutes } from './routes/character.js';
import { registerTableRoutes } from './routes/table.js';
import { registerPageRoutes } from './routes/pages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '../../public');
const RULES_DIR = resolve(HERE, '../rules');
const SHARED_DIR = resolve(HERE, '../shared');

/**
 * The token is in the path, so Fastify must not log the path. The framework's
 * own per-request lines carry `req.url`, and there is no way to redact just
 * that, so they are turned off wholesale and the routes log what is safe
 * themselves. Expressed as a controller rather than the `disableRequestLogging`
 * option, which is deprecated in Fastify 5.
 */
export async function buildApp({ db, logger = false, trustProxy = true } = {}) {
  const app = Fastify({
    logger,
    trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.decorate('db', db);

  await app.register(rateLimit, {
    global: false,
    // Keyed by IP. A GM refreshing a dashboard is nowhere near this; someone
    // walking the token space hits it immediately.
    max: 30,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (request, reply, payload) => {
    securityHeaders(reply);
    return payload;
  });

  // Static assets only. The HTML shells are served by named routes so a wrong
  // token gets a refusal rather than an empty sheet, and so no directory of
  // pages is browsable.
  /**
   * Caching, with no build step to hash filenames into.
   *
   * Scripts and stylesheets are revalidated every time (`no-cache` still uses
   * the ETag, so an unchanged file is a 304 and a few bytes). A timed cache
   * would be cheaper and would also let a client run a mix of old and new ES
   * modules after a deploy, which fails in ways nobody can reproduce.
   *
   * Fonts are the exception: they change only when `npm run build:fonts` is
   * run deliberately, and refetching 56 KB on every page load on a phone at a
   * table is exactly what a cache is for.
   */
  const setAssetHeaders = (reply, path) => {
    const cacheable = /\.(woff2?|png|svg|jpe?g|ico)$/i.test(path);
    reply.header('cache-control', cacheable ? 'public, max-age=86400' : 'no-cache');
  };

  await app.register(fastifyStatic, {
    root: resolve(PUBLIC_DIR, 'assets'),
    prefix: '/assets/',
    index: false,
    cacheControl: false,
    setHeaders: setAssetHeaders,
  });

  // The rules engine, served to the browser as the same files the server and
  // the tests import. Copying it into public/ would be a build step, and two
  // copies of the arithmetic is exactly what the engine exists to prevent.
  // `src/rules` imports `../shared/...`, so the two mounts have to sit under a
  // common prefix for that relative path to resolve.
  for (const [prefix, root] of [['/engine/rules/', RULES_DIR], ['/engine/shared/', SHARED_DIR]]) {
    await app.register(fastifyStatic, {
      root, prefix, index: false, cacheControl: false, decorateReply: false,
      setHeaders: setAssetHeaders,
    });
  }

  app.get('/robots.txt', async (request, reply) => {
    reply.type('text/plain');
    return ROBOTS_TXT;
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error, route: request.routeOptions?.url }, 'request failed');
      return reply.status(500).send({ error: 'Something went wrong' });
    }
    return reply.status(status).send({ error: error.message });
  });

  await registerPageRoutes(app, { publicDir: PUBLIC_DIR });

  await app.register(scopedRoutes('gm', registerGmRoutes), { prefix: '/api/gm/:token' });
  await app.register(scopedRoutes('character', registerCharacterRoutes), { prefix: '/api/c/:token' });
  await app.register(scopedRoutes('table', registerTableRoutes), { prefix: '/api/table/:token' });

  return app;
}

/**
 * The gate every request passes through.
 *
 * A malformed token, an unknown token and a revoked token all produce the same
 * 404 after the same work, so none of them can be told apart from outside.
 */
function scopedRoutes(kind, register) {
  return async function plugin(app) {
    app.addHook('onRequest', app.rateLimit());

    app.addHook('onRequest', async (request, reply) => {
      const raw = request.params.token;
      const token = normalizeToken(raw);

      const deny = () => {
        recordFailure(app.db, {
          ip: request.ip,
          path: request.routeOptions?.url ?? '',
          tokenPrefix: tokenFingerprint(token),
        });
        request.log.warn(
          { ip: request.ip, kind, token: tokenFingerprint(token) },
          'access denied',
        );
        return reply.status(404).send({ error: 'Not found' });
      };

      if (!isWellFormed(token)) return deny();

      const scope = resolveScope(app.db, token);
      if (!scope) return deny();

      // A token of the wrong kind is not merely unauthorized for this route, it
      // is the wrong link entirely -- and saying so would confirm the token is
      // real, so it gets the same 404.
      if (scope.kind !== kind) return deny();

      request.scope = scope;
      touchToken(app.db, scope.tokenId);
      return undefined;
    });

    await register(app);
  };
}

export { ScopeError, NotFoundError };
