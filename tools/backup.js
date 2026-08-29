#!/usr/bin/env node
/**
 * `npm run backup [destination]`
 *
 * One file, consistent, safe to take while the server is running and serving.
 *
 * This exists because the obvious thing is wrong. The database is in WAL mode,
 * so recent writes live in `off-guard.sqlite-wal` until a checkpoint, and
 * `cp off-guard.sqlite elsewhere` silently leaves them behind. That is not
 * hypothetical: while testing the token migration, a copy taken that way came
 * back with one token in it instead of three, and nothing about it looked
 * wrong.
 *
 * The documented alternative was `sqlite3 ... ".backup ..."`, which is correct
 * but assumes the SQLite command-line tool is installed. It is not on a stock
 * macOS with Homebrew Node, and it is not on a minimal Debian. The same online
 * backup API is already linked into `better-sqlite3`, which this application
 * cannot run without, so reaching it through Node needs nothing new.
 *
 * The result is a single file with no sidecars, which is what you want when the
 * next step is scp to another machine. That takes one more step than copying:
 * the online backup gives the copy the source's journal mode, so a backup of a
 * WAL database is a WAL database, and moving it by ordinary means would have
 * exactly the hazard this tool exists to avoid. It is switched to DELETE
 * journalling before anyone can be handed it.
 *
 *     npm run backup                                  # ~/off-guard-backups/<date>.sqlite
 *     npm run backup /Volumes/Backup/off-guard.sqlite
 *     npm run backup --verify-only /path/to/one.sqlite
 *     npm run backup --skip-existing                  # for the weekly agent
 *
 * A backup is a complete copy of every campaign, every character sheet and
 * every token hash. Tokens are hashed, so a stolen backup does not hand anyone
 * a working link -- but it is still the whole table's data, and it belongs
 * somewhere you would put a password manager export.
 */
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { config } from '../src/server/index.js';

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
// For the scheduled run. Today's backup already existing is the normal state
// of a job that has already run today, not a failure worth a log line and a
// non-zero exit -- but a person naming a destination should still be told.
const skipExisting = args.includes('--skip-existing');
const target = args.find((a) => !a.startsWith('--'));

const bytes = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * The tables the summary counts.
 *
 * Named rather than discovered, so that a backup of the wrong file, or of a
 * database a migration has moved on from, says so instead of reporting a
 * confident zero. `tests/backup.test.js` keeps this list in step with the
 * migrations, so a rename breaks a test rather than a backup.
 */
const COUNTED = ['campaign', 'character', 'encounter', 'token'];

/**
 * Read the copy back and make sure it is a database rather than a file.
 *
 * `integrity_check` walks the pages; the counts are here because a structurally
 * valid database with nothing in it would pass that and still be the wrong
 * thing to carry to a new machine.
 */
export function verify(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const [{ integrity_check: integrity }] = db.pragma('integrity_check');
    if (integrity !== 'ok') throw new Error(`integrity_check says: ${integrity}`);

    return Object.fromEntries(COUNTED.map((table) => (
      [table, db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n]
    )));
  } finally {
    db.close();
  }
}

/** "2 campaigns, 5 characters, 3 encounters, 6 tokens" */
const summarise = (rows) => Object.entries(rows)
  .map(([table, n]) => `${n} ${table}${n === 1 ? '' : 's'}`)
  .join(', ');

const stamp = new Date().toISOString().slice(0, 10);
const destination = resolve(target ?? `${homedir()}/off-guard-backups/${stamp}.sqlite`);

if (verifyOnly) {
  if (!existsSync(destination)) {
    process.stderr.write(`\nThere is no file at ${destination}\n\n`);
    process.exit(1);
  }
  process.stdout.write(
    `\n${destination}\n  ${bytes(statSync(destination).size)}, integrity ok\n`
    + `  ${summarise(verify(destination))}\n\n`,
  );
  process.exit(0);
}

const settings = config();
if (!existsSync(settings.database)) {
  process.stderr.write(
    `\nThere is no database at ${settings.database}\n\n`
    + 'That is the path this checkout resolves, from OFF_GUARD_DB or .env.\n'
    + 'If the server is running somewhere else, run this from its directory.\n\n',
  );
  process.exit(1);
}

if (existsSync(destination) && skipExisting) {
  process.stdout.write(`\n${destination} is already there. Nothing to do.\n\n`);
  process.exit(0);
}

// Refusing rather than overwriting: the argument is a path someone typed, and
// the thing at the other end of it is the only copy of somebody's campaign.
if (existsSync(destination)) {
  process.stderr.write(
    `\nThere is already a file at ${destination}\n\n`
    + 'Move it, or name the backup something else. This will not overwrite it.\n\n',
  );
  process.exit(1);
}

// 0700, because the default destination is a directory this creates in a home
// directory and then fills with complete copies of everybody's data.
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });

// No migrations: a backup copies what is there. Running migrations against a
// live database as a side effect of backing it up would be a surprising way to
// find out the checkout is newer than the server.
const db = new Database(settings.database, { readonly: true, fileMustExist: true });

process.stdout.write(`\nFrom: ${settings.database}\n  To: ${destination}\n\n`);

try {
  // The online backup API. It copies page by page and restarts if a writer
  // commits underneath it, which is what makes this safe against a server
  // that is mid-session rather than merely usually safe.
  await db.backup(destination);
} finally {
  db.close();
}

// Owner only. A backup is every campaign, every character sheet and every
// token hash; hashing means a stolen copy is not a set of working links, but it
// is still the whole table's data, and the default umask would have made it
// world-readable. `deploy/MIGRATING.md` restores it with the same mode.
chmodSync(destination, 0o600);

// And make it genuinely one file. The copy inherits WAL from the source, so
// without this the backup is three files and handing it to someone who copies
// only the first reproduces the failure this tool is here to prevent. DELETE
// journalling folds the log in and leaves nothing beside it.
const copy = new Database(destination);
try {
  copy.pragma('journal_mode = DELETE');
} finally {
  copy.close();
}

process.stdout.write(
  `Done. ${bytes(statSync(destination).size)}, integrity ok.\n`
  + `  ${summarise(verify(destination))}\n\n`
  + 'One file, no sidecars: safe to copy anywhere.\n\n',
);
