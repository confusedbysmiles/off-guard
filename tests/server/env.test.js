/**
 * `.env`.
 *
 * This module exists because the CLI and the service disagreed about which
 * database they meant, silently. The tests that matter are the two that keep
 * them agreeing: a real environment variable wins, and a missing file is not an
 * error.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadEnv, parseEnv } from '../../src/server/env.js';

const withFile = (contents) => {
  const file = join(mkdtempSync(join(tmpdir(), 'off-guard-env-')), '.env');
  writeFileSync(file, contents);
  return file;
};

describe('parsing', () => {
  it('reads plain assignments', () => {
    expect(parseEnv('OFF_GUARD_PORT=8787')).toEqual({ OFF_GUARD_PORT: '8787' });
  });

  it('ignores comments and blank lines', () => {
    expect(parseEnv('# a note\n\n  \nA=1\n')).toEqual({ A: '1' });
  });

  it('tolerates the `export` people paste in from a shell', () => {
    expect(parseEnv('export A=1')).toEqual({ A: '1' });
  });

  /** The default database path on macOS is under "Application Support". */
  it('keeps spaces in an unquoted path', () => {
    expect(parseEnv('OFF_GUARD_DB=/Users/a/Library/Application Support/off-guard/x.sqlite'))
      .toEqual({ OFF_GUARD_DB: '/Users/a/Library/Application Support/off-guard/x.sqlite' });
  });

  it('strips a trailing comment, but not one inside quotes', () => {
    expect(parseEnv('A=value # why')).toEqual({ A: 'value' });
    expect(parseEnv('A="value # why"')).toEqual({ A: 'value # why' });
  });

  it('skips lines that are not assignments, and keys that are not names', () => {
    expect(parseEnv('nonsense\n9BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' });
  });

  it('keeps an empty value rather than dropping the key', () => {
    // `OFF_GUARD_BASE_PATH=` means the host root, and is not the same as unset.
    expect(parseEnv('OFF_GUARD_BASE_PATH=')).toEqual({ OFF_GUARD_BASE_PATH: '' });
  });
});

describe('loading', () => {
  it('applies what is in the file', () => {
    const env = {};
    const result = loadEnv({ file: withFile('OFF_GUARD_DB=/tmp/x.sqlite'), env });
    expect(result.found).toBe(true);
    expect(env.OFF_GUARD_DB).toBe('/tmp/x.sqlite');
  });

  /**
   * The load-bearing one. The launchd plist sets `OFF_GUARD_DB` for the
   * service; `.env` must not override it, or moving the database would take two
   * edits and half of them would be forgotten.
   */
  it('never overwrites a variable that is already set', () => {
    const env = { OFF_GUARD_DB: '/from/the/plist.sqlite' };
    loadEnv({ file: withFile('OFF_GUARD_DB=/from/the/file.sqlite'), env });
    expect(env.OFF_GUARD_DB).toBe('/from/the/plist.sqlite');
  });

  it('is silent when there is no file', () => {
    const env = {};
    const result = loadEnv({ file: '/nonexistent/.env', env });
    expect(result.found).toBe(false);
    expect(env).toEqual({});
  });

  it('reports what it applied, so a tool can say where a setting came from', () => {
    const env = { OFF_GUARD_PORT: '9999' };
    const result = loadEnv({
      file: withFile('OFF_GUARD_PORT=8787\nOFF_GUARD_LOG_LEVEL=debug'),
      env,
    });
    expect(result.applied).toEqual({ OFF_GUARD_LOG_LEVEL: 'debug' });
  });
});

describe('every key in .env.example is one the application reads', () => {
  it('documents nothing that does nothing', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const read = (dir) => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? read(path) : [readFileSync(path, 'utf8')];
    });
    const source = [...read('src'), ...read('tools')].join('\n');

    const documented = Object.keys(parseEnv(readFileSync('.env.example', 'utf8')));
    for (const key of documented) {
      expect(source.includes(key), `${key} is in .env.example but nothing reads it`).toBe(true);
    }
    expect(documented.length).toBeGreaterThan(3);
  });
});
