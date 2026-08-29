#!/usr/bin/env node
/**
 * `npm run mint-gm`
 *
 * Mints the one GM token, on the command line, so there is no setup page left
 * exposed on the host afterwards. Refuses to mint a second: a spare GM token
 * nobody remembers issuing is exactly the thing this access model cannot have.
 * Use the dashboard's rotate to replace one.
 *
 * It says which database it opened, every time, including when it refuses.
 * "A GM token already exists" is a complete sentence and a useless one when the
 * database it is about is not the one the running server is using -- which is
 * exactly what happens when the service takes its path from a launchd plist and
 * a shell takes the default.
 */
import { openDatabase } from '../src/server/db.js';
import { mintGmToken } from '../src/server/store/tokens.js';
import { config } from '../src/server/index.js';

const settings = config();
const db = openDatabase(settings.database, { migrationsDir: settings.migrations });

process.stdout.write(`\nDatabase: ${settings.database}\n`);

try {
  const token = mintGmToken(db, { note: process.argv[2] ?? '' });
  process.stdout.write(
    `\nGM link:\n\n  /gm/${token}\n\n`
    + 'This is shown once. Store it somewhere you will find it.\n\n',
  );
} catch (error) {
  process.stderr.write(
    `\n${error.message}\n\n`
    + 'If that is not the database you meant, set OFF_GUARD_DB -- in .env, or\n'
    + 'for one command:\n\n'
    + '  OFF_GUARD_DB=/path/to/off-guard.sqlite node tools/mint-gm-token.js\n\n',
  );
  process.exitCode = 1;
} finally {
  db.close();
}
