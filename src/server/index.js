#!/usr/bin/env node
/**
 * `npm start`
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { openDatabase } from './db.js';
import { openCatalogue } from './catalogue.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function config(env = process.env) {
  return {
    host: env.OFF_GUARD_HOST ?? '127.0.0.1',
    port: Number(env.OFF_GUARD_PORT ?? 8787),
    database: env.OFF_GUARD_DB ?? resolve(ROOT, 'off-guard.sqlite'),
    migrations: resolve(ROOT, 'migrations'),
    logLevel: env.OFF_GUARD_LOG_LEVEL ?? 'info',
  };
}

async function main() {
  const settings = config();
  const db = openDatabase(settings.database, { migrationsDir: settings.migrations });

  const catalogue = openCatalogue();
  const app = await buildApp({
    db,
    catalogue,
    logger: { level: settings.logLevel },
  });

  if (!catalogue.available) {
    app.log.warn(catalogue.reason);
  }

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: settings.host, port: settings.port });
  app.log.info(`Off-Guard on http://${settings.host}:${settings.port}, database ${settings.database}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
