#!/usr/bin/env node
/**
 * `npm run mint-gm`
 *
 * Mints the one GM token, on the command line, so there is no setup page left
 * exposed on the host afterwards. Refuses to mint a second: a spare GM token
 * nobody remembers issuing is exactly the thing this access model cannot have.
 * Use the dashboard's rotate to replace one.
 */
import { openDatabase } from '../src/server/db.js';
import { mintGmToken } from '../src/server/store/tokens.js';
import { config } from '../src/server/index.js';

const settings = config();
const db = openDatabase(settings.database, { migrationsDir: settings.migrations });

try {
  const token = mintGmToken(db, { note: process.argv[2] ?? '' });
  process.stdout.write(`\nGM link:\n\n  /gm/${token}\n\nThis is shown once. Store it somewhere you will find it.\n\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}
