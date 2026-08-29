/**
 * Backing the database up.
 *
 * The first test is the reason the tool exists. It reproduces the failure the
 * obvious approach has -- copying `off-guard.sqlite` and leaving the write-ahead
 * log behind -- and then shows the tool not having it. That failure is not
 * theoretical: taking a copy that way during the token migration produced a
 * database with one token in it instead of three, and nothing about the copy
 * looked wrong.
 *
 * The tool is run as a subprocess rather than imported, because what has to
 * work is the command someone types at two in the morning before moving a
 * machine: its arguments, its refusals and its exit codes.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { openDatabase } from '../src/server/db.js';
import { resolveScope } from '../src/server/scope.js';
import { createCampaign } from '../src/server/store/campaigns.js';
import { mintGmToken } from '../src/server/store/tokens.js';

const ROOT = resolve(import.meta.dirname, '..');
const TOOL = join(ROOT, 'tools/backup.js');

/** The tables `tools/backup.js` counts, which have to keep existing. */
const COUNTED = ['campaign', 'character', 'encounter', 'token'];

/**
 * A database with writes that are still only in the WAL.
 *
 * Left open on purpose: a `close()` checkpoints, which is exactly the state
 * this needs not to be in.
 */
function liveDatabase(campaigns = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'off-guard-backup-'));
  const file = join(dir, 'off-guard.sqlite');
  const db = openDatabase(file, { migrationsDir: join(ROOT, 'migrations') });
  const gm = resolveScope(db, mintGmToken(db));
  for (let n = 0; n < campaigns; n += 1) {
    createCampaign(db, gm, { name: `Campaign ${n}`, partyLevel: 1 });
  }
  return { dir, file, db };
}

const run = (args, file) => execFileSync('node', [TOOL, ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, OFF_GUARD_DB: file },
});

const countIn = (file) => {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT count(*) AS n FROM campaign').get().n;
  } finally {
    db.close();
  }
};

/** The count, or null when the file is not a usable database at all. */
const maybeCountIn = (file) => {
  try {
    return countIn(file);
  } catch {
    return null;
  }
};

describe('against a running server', () => {
  it('takes the write-ahead log with it, where a plain copy does not', () => {
    const { dir, file, db } = liveDatabase(4);

    // The premise: there really are writes that are not in the main file yet.
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);

    // What `cp off-guard.sqlite elsewhere` gets you. Not four campaigns --
    // and in a database this young, not even a schema, because the migrations
    // that created the tables are themselves still in the log.
    const naive = join(dir, 'naive.sqlite');
    copyFileSync(file, naive);
    expect(maybeCountIn(naive)).not.toBe(4);

    // What the tool gets you.
    const backup = join(dir, 'backup.sqlite');
    run([backup], file);
    expect(countIn(backup)).toBe(4);

    db.close();
  });

  it('writes one file, with no sidecars to forget', () => {
    // The copy inherits the source's journal mode, so this is a real risk and
    // not a formality: a WAL backup moved with `cp` loses whatever the backup
    // itself had not checkpointed.
    const { dir, file, db } = liveDatabase();
    const backup = join(dir, 'backup.sqlite');
    run([backup], file);

    expect(statSync(backup).isFile()).toBe(true);
    for (const sidecar of ['-wal', '-shm']) {
      expect(() => statSync(backup + sidecar)).toThrow();
    }
    db.close();
  });

  it('writes it owner-only', () => {
    // The whole table's data, in a file the default umask would have made
    // world-readable.
    const { dir, file, db } = liveDatabase();
    const backup = join(dir, 'backup.sqlite');
    run([backup], file);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    db.close();
  });

  it('reports what it copied, so an empty backup is visible', () => {
    const { dir, file, db } = liveDatabase(2);
    const backup = join(dir, 'backup.sqlite');
    expect(run([backup], file)).toContain('2 campaigns');
    expect(run(['--verify-only', backup], file)).toContain('integrity ok');
    db.close();
  });
});

describe('refusals', () => {
  it('will not overwrite a file that is already there', () => {
    const { dir, file, db } = liveDatabase();
    const backup = join(dir, 'backup.sqlite');
    run([backup], file);
    const before = statSync(backup).mtimeMs;

    expect(() => run([backup], file)).toThrow(/already a file/);
    expect(statSync(backup).mtimeMs).toBe(before);
    db.close();
  });

  it('says which database it could not find, rather than making one', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'off-guard-backup-')), 'nope.sqlite');
    expect(() => run([join(tmpdir(), 'out.sqlite')], missing)).toThrow(/no database at/);
    expect(() => statSync(missing)).toThrow();
  });
});

describe('the tables it counts', () => {
  it('all exist, so a rename breaks this and not a backup', () => {
    const { file, db } = liveDatabase(0);
    const names = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    for (const table of COUNTED) expect(names, `${file}: ${table}`).toContain(table);
    db.close();
  });

  it('is the same list the tool has', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(TOOL, 'utf8');
    const listed = /const COUNTED = \[([^\]]+)\]/.exec(source)[1]
      .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    expect(listed).toEqual(COUNTED);
  });
});
