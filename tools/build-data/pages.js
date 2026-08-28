/**
 * Hand-maintained page references.
 *
 * Foundry carries no page numbers (its publication block is title/license/
 * remaster only), so `source.page` comes from the tables in
 * `tools/build-data/pages/*.json`, keyed by Off-Guard entry id. Keys that match
 * no entry are reported rather than ignored: a typo should fail loudly at build
 * time, not render as a silent `null` two months later.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadPageTable(dir) {
  const pages = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return { pages, books: 0 };
  }
  for (const file of files) {
    const table = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [id, page] of Object.entries(table.pages ?? {})) {
      pages.set(id, { page, book: table.book ?? null, file });
    }
  }
  return { pages, books: files.length };
}

/**
 * Stamp the page onto a normalized record. Returns true when a page was
 * applied, so the caller can tell which table entries went unused.
 */
export function applyPage(record, pageTable) {
  const entry = pageTable.get(record.id);
  if (!entry) return false;
  record.source.page = entry.page;
  return true;
}
