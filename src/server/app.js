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
import { failureCount, recordFailure, touchToken } from './store/tokens.js';
import { ROBOTS_TXT, securityHeaders } from './security.js';
import { registerGmRoutes } from './routes/gm/index.js';
import { registerCharacterRoutes } from './routes/character.js';
import { registerTableRoutes } from './routes/table.js';
import { registerPageRoutes } from './routes/pages.js';
import { openCatalogue } from './catalogue.js';
import { loadReference } from './reference.js';
import { createEventBus } from './events.js';

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
export async function buildApp({
  db, catalogue = null, reference = null, bus = null, logger = false, trustProxy = true,
  basePath = '',
} = {}) {
  const mount = normalizeBasePath(basePath);
  const app = Fastify({
    logger,
    trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.decorate('db', db);
  // The catalogue is global across campaigns and read-only, so it is a
  // process-wide value rather than something a request builds.
  app.decorate('catalogue', catalogue ?? openCatalogue());
  // Same reasoning for the reference corpus: checked in, read-only, one copy.
  app.decorate('reference', reference ?? loadReference({ log: app.log }));
  app.decorate('bus', bus ?? createEventBus());
  app.addHook('onClose', async () => { app.bus.close(); });

  /**
   * Two different limits, because they defend against two different things.
   *
   * This one is a ceiling on traffic from a single address -- generous, because
   * the legitimate user is one GM whose dashboard makes several requests per
   * action, and a cap tight enough to matter to an attacker would throttle a
   * session at a table. Guessing is handled below by counting *failures*, which
   * is what an attacker produces and a real user does not.
   */
  await app.register(rateLimit, {
    global: false,
    max: 600,
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

  /**
   * Everything the browser can reach lives inside this one plugin, so mounting
   * the application under a subdirectory is a single prefix rather than a
   * prefix threaded through twenty registrations. The browser side needs no
   * matching setting: the pages work their own mount point out from their
   * address, which is why nothing they load is root-absolute any more.
   */
  await app.register(async (site) => {
    await site.register(fastifyStatic, {
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
      await site.register(fastifyStatic, {
        root, prefix, index: false, cacheControl: false, decorateReply: false,
        setHeaders: setAssetHeaders,
      });
    }

    // Served here as well as from the host root, which nginx handles: a
    // subdirectory install cannot reach the root of a domain it shares.
    site.get('/robots.txt', async (request, reply) => {
      reply.type('text/plain');
      return ROBOTS_TXT;
    });

    site.get('/healthz', async () => ({ ok: true }));

    await registerPageRoutes(site, { publicDir: PUBLIC_DIR });

    await site.register(scopedRoutes('gm', registerGmRoutes), { prefix: '/api/gm/:token' });
    await site.register(scopedRoutes('character', registerCharacterRoutes), { prefix: '/api/c/:token' });
    await site.register(scopedRoutes('table', registerTableRoutes), { prefix: '/api/table/:token' });
  }, mount ? { prefix: mount } : {});

  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error, route: request.routeOptions?.url }, 'request failed');
      return reply.status(500).send({ error: 'Something went wrong' });
    }
    return reply.status(status).send({ error: error.message });
  });

  return app;
}

/**
 * `/off-guard`, `off-guard/`, `/off-guard/` and `` all mean the same thing.
 * Normalized to a leading slash and no trailing one, or the empty string for a
 * host root, because Fastify's prefix and the client's `../` arithmetic both
 * depend on there being exactly one form.
 */
export function normalizeBasePath(value) {
  const trimmed = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/**
 * The gate every request passes through.
 *
 * A malformed token, an unknown token and a revoked token all produce the same
 * 404 after the same work, so none of them can be told apart from outside.
 */
/** A wrong link is a typo once or twice, not fifteen times in five minutes. */
const FAILURE_LIMIT = 15;
const FAILURE_WINDOW_MINUTES = 5;

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

      // Someone walking the token space is recognisable by their failures, and
      // is stopped after a handful of them rather than after a fixed number of
      // requests. 128 bits is not guessable anyway; this makes it visible.
      if (failureCount(app.db, request.ip, { minutes: FAILURE_WINDOW_MINUTES })
          >= FAILURE_LIMIT) {
        request.log.warn({ ip: request.ip }, 'too many failed token attempts');
        return reply.status(429).send({ error: 'Too many attempts. Try again later.' });
      }

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
