#!/usr/bin/env node
/**
 * `npm start`
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { openDatabase } from './db.js';
import { openCatalogue } from './catalogue.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function config(env = process.env) {
  // Read `.env` first, so a shell and the service agree about which database
  // they mean. A real environment variable still wins.
  loadEnv({ env });
  return {
    host: env.OFF_GUARD_HOST ?? '127.0.0.1',
    port: Number(env.OFF_GUARD_PORT ?? 8787),
    database: env.OFF_GUARD_DB ?? resolve(ROOT, 'off-guard.sqlite'),
    migrations: resolve(ROOT, 'migrations'),
    logLevel: env.OFF_GUARD_LOG_LEVEL ?? 'info',
    // '' serves from the host root; '/off-guard' from a subdirectory of one.
    basePath: env.OFF_GUARD_BASE_PATH ?? '',
  };
}

async function main() {
  const settings = config();
  const db = openDatabase(settings.database, { migrationsDir: settings.migrations });

  const catalogue = openCatalogue();
  const app = await buildApp({
    db,
    catalogue,
    basePath: settings.basePath,
    logger: { level: settings.logLevel },
  });

  if (!catalogue.available) {
    app.log.warn(catalogue.reason);
  }

  /**
   * Stop, and never hang doing it.
   *
   * `app.close()` waits for in-flight requests, and a Server-Sent Events stream
   * is an in-flight request that by design never finishes. The bus ends those
   * streams from an onClose hook, so the ordinary path is immediate -- but
   * "immediate" must not depend on that staying true. Without a backstop the
   * failure mode is systemd's stop timeout and a SIGKILL over an open SQLite
   * database: ninety seconds of 502 on every deploy, which is how this was
   * found.
   *
   * The database is closed on both paths. A SIGKILL leaves the WAL to be
   * recovered on next open, which works, but "it recovers" is a poor thing to
   * rely on weekly.
   */
  const GRACE_MS = Number(process.env.OFF_GUARD_SHUTDOWN_MS ?? 10_000);
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;

    const giveUp = setTimeout(() => {
      app.log.warn(`Shutdown did not finish in ${GRACE_MS}ms; exiting anyway.`);
      try { db.close(); } catch { /* going down regardless */ }
      process.exit(0);
    }, GRACE_MS);

    try {
      await app.close();
      db.close();
    } finally {
      clearTimeout(giveUp);
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: settings.host, port: settings.port });
  app.log.info(
    `Off-Guard on http://${settings.host}:${settings.port}${settings.basePath}, `
    + `database ${settings.database}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
