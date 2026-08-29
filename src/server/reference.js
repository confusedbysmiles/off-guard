/**
 * The reference corpus.
 *
 * `data/reference.json` is checked in and never changes at runtime, so it is
 * read once at startup, kept as the serialized string it will be sent as, and
 * given an ETag. A GM who reloads the dashboard four times in an evening pays
 * for it once.
 *
 * If the file is missing the drawer degrades the same way the catalogue does:
 * an `available: false` payload the interface can explain, rather than a 500.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadReference({ file = resolve(PROJECT_ROOT, 'data/reference.json'), log } = {}) {
  let body;
  try {
    body = readFileSync(file, 'utf8');
  } catch (error) {
    log?.warn?.(
      { file, err: error.code },
      'data/reference.json is missing; the reference drawer will say so. Run `npm run build:reference`.',
    );
    const unavailable = JSON.stringify({ available: false, groups: [], entries: [] });
    return { body: unavailable, etag: '"none"', available: false, count: 0 };
  }

  const parsed = JSON.parse(body);
  const payload = JSON.stringify({ available: true, ...parsed });
  return {
    body: payload,
    etag: `"${createHash('sha256').update(payload).digest('hex').slice(0, 16)}"`,
    available: true,
    count: parsed.entries?.length ?? 0,
  };
}
