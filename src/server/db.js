/**
 * The database.
 *
 * One SQLite file, WAL mode, migrations applied at startup from `migrations/`.
 * No ORM: the queries in `src/server/store/` are the schema's only callers, and
 * every one of them takes a resolved scope rather than a campaign id from a
 * request body.
 */
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function openDatabase(file, { migrationsDir, verbose = null } = {}) {
  const db = new Database(file, { verbose });

  // WAL lets the shared screen read while the GM writes, which is the whole
  // traffic pattern of a live table.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // NORMAL is the documented pairing with WAL: durable across process crashes,
  // and only at risk from a power cut mid-write, which is an acceptable trade
  // for a game table's notes.
  db.pragma('synchronous = NORMAL');

  if (migrationsDir) migrate(db, migrationsDir);
  return db;
}

export function migrate(db, dir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migration').all().map((r) => r.version),
  );

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    // Each migration is one transaction: a half-applied schema is worse than a
    // failed startup.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (version) VALUES (?)').run(version);
      db.exec('COMMIT');
      ran.push(version);
    } catch (error) {
      db.exec('ROLLBACK');
      error.message = `Migration ${file} failed: ${error.message}`;
      throw error;
    }
  }

  return ran;
}
