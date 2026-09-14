#!/usr/bin/env node
/**
 * The server the end-to-end suite runs against.
 *
 * A fresh temporary database each time, so the tests can be run twice in a row
 * and never touch a real one.
 */
import { buildApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/db.js';
import { openCatalogue } from '../src/server/catalogue.js';
import { buildFixture } from './fixture.js';

const port = Number(process.argv[2] ?? 8799);
const world = buildFixture(port);
const db = openDatabase(world.database, {});

/**
 * No per-address ceiling here. See the note on `limits` in `buildApp`: this
 * suite makes more requests in a minute than a table makes in an evening, and
 * throttling it produces test failures that look like anything but throttling.
 */
const app = await buildApp({
  db, catalogue: openCatalogue(), logger: false, limits: { max: 100000 },
});
await app.listen({ host: '127.0.0.1', port });

process.on('SIGTERM', async () => { await app.close(); db.close(); process.exit(0); });
process.on('SIGINT', async () => { await app.close(); db.close(); process.exit(0); });
