/**
 * `.env`, read by the server and by every command-line tool.
 *
 * This exists because of a real failure, not for tidiness. The service gets its
 * database path from the launchd plist; a `node tools/mint-gm-token.js` typed
 * into a shell got the default instead, quietly operated on a different SQLite
 * file, and reported "A GM token already exists" about a database the running
 * server had never opened. Nothing in that message was wrong and nothing in it
 * was useful.
 *
 * `.env.example` had documented this file since the first commit. Nothing read
 * it. Now everything does, so one file is the answer to "which database".
 *
 * Hand-rolled rather than `dotenv`: it is fifteen lines, and a dependency whose
 * job is `split('=')` is a dependency that still has to be audited, updated and
 * trusted.
 *
 * A real environment variable always wins. That is what keeps the plist
 * authoritative for the service and keeps `OFF_GUARD_DB=... node ...` working
 * for a one-off.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Parse `.env` contents. Exported so it can be tested without a file. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Quoted values keep their spaces and their trailing '#'.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: a '#' after the value starts a comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `.env` into `process.env`, without overwriting anything already set.
 * Returns what it applied, so a tool can say where its settings came from.
 */
export function loadEnv({ file = resolve(ROOT, '.env'), env = process.env } = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { file, found: false, applied: {} };
  }

  const applied = {};
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (key in env) continue;
    env[key] = value;
    applied[key] = value;
  }
  return { file, found: true, applied };
}
