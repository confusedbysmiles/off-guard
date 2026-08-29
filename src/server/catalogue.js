/**
 * The creature and hazard catalogue.
 *
 * Search runs on the server rather than in the browser. The index is 2.6 MB
 * across ~7,600 rows; shipping it to a phone so the GM can find a goblin would
 * be worse than a request, and the server already has to load the packs to
 * return a stat block anyway.
 *
 * Global across campaigns, deliberately: monster data, reference tables and
 * homebrew belong to the GM, not to a table.
 *
 * The whole thing is optional. A clone that has not run `npm run build:data`
 * still starts, and the dashboard says the catalogue is missing rather than
 * failing in a way that looks like a bug.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');

export function openCatalogue({ dataDir = DATA_DIR } = {}) {
  const indexFile = resolve(dataDir, 'index.json');
  if (!existsSync(indexFile)) {
    return {
      available: false,
      reason: 'No catalogue. Run `npm run build:data`.',
      search: () => ({ rows: [], total: 0, available: false }),
      get: () => null,
      traits: () => [],
      sources: () => [],
      stats: () => ({ available: false }),
    };
  }

  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const rows = index.rows ?? [];

  // Which pack file holds each entry, so a stat block is one file read rather
  // than a scan of sixty-four.
  const packOf = new Map(rows.map((row) => [row.id, { pack: row.pack, kind: row.kind }]));
  const packCache = new Map();

  function loadPack(kind, pack) {
    const key = `${kind}:${pack}`;
    if (!packCache.has(key)) {
      const file = resolve(dataDir, kind === 'creature' ? 'creatures' : 'hazards', `${pack}.json`);
      if (!existsSync(file)) return new Map();
      const entries = JSON.parse(readFileSync(file, 'utf8'));
      packCache.set(key, new Map(entries.map((entry) => [entry.id, entry])));
    }
    return packCache.get(key);
  }

  const traitCounts = new Map();
  const sourceCounts = new Map();
  for (const row of rows) {
    for (const trait of row.traits ?? []) traitCounts.set(trait, (traitCounts.get(trait) ?? 0) + 1);
    if (row.book) sourceCounts.set(row.book, (sourceCounts.get(row.book) ?? 0) + 1);
  }

  /**
   * A linear scan.
   *
   * Measured at ~2 ms over 7,600 rows, which is under a search-as-you-type
   * keystroke on a local server and is readable two years from now, which an
   * inverted index would not be. If it ever stops being fast enough the fix is
   * a prefix map on `search`, not a dependency.
   */
  function search({
    q = '', levelMin = null, levelMax = null, traits = [], rarity = null,
    size = null, creatureType = null, source = null, kind = 'creature',
    includeSuperseded = false, limit = 50, offset = 0, sort = 'level',
  } = {}) {
    const needle = String(q ?? '').trim().toLowerCase();
    const wanted = (traits ?? []).map((t) => String(t).toLowerCase()).filter(Boolean);

    const matched = rows.filter((row) => {
      if (kind && row.kind !== kind) return false;
      if (!includeSuperseded && row.supersededBy) return false;
      if (needle && !row.search.includes(needle)) return false;
      if (levelMin !== null && row.level < Number(levelMin)) return false;
      if (levelMax !== null && row.level > Number(levelMax)) return false;
      if (rarity && row.rarity !== rarity) return false;
      if (size && row.size !== size) return false;
      if (creatureType && row.creatureType !== creatureType) return false;
      if (source && row.book !== source) return false;
      // Every requested trait must be present, not any of them: a GM filtering
      // for "undead" and "spellcaster" wants both.
      for (const trait of wanted) if (!(row.traits ?? []).includes(trait)) return false;
      return true;
    });

    const compare = {
      level: (a, b) => a.level - b.level || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      'level-desc': (a, b) => b.level - a.level || a.name.localeCompare(b.name),
    }[sort] ?? ((a, b) => a.level - b.level);

    matched.sort(compare);

    return {
      available: true,
      total: matched.length,
      rows: matched.slice(Number(offset), Number(offset) + Number(limit)),
    };
  }

  function get(id) {
    const where = packOf.get(id);
    if (!where) return null;
    return loadPack(where.kind, where.pack).get(id) ?? null;
  }

  return {
    available: true,
    reason: null,
    search,
    get,
    has: (id) => packOf.has(id),
    traits: () => [...traitCounts.entries()]
      .map(([trait, count]) => ({ trait, count }))
      .sort((a, b) => b.count - a.count || a.trait.localeCompare(b.trait)),
    sources: () => [...sourceCounts.entries()]
      .map(([book, count]) => ({ book, count }))
      .sort((a, b) => a.book.localeCompare(b.book)),
    stats: () => ({
      available: true,
      commit: index.generated?.commit ?? null,
      creatures: rows.filter((r) => r.kind === 'creature').length,
      hazards: rows.filter((r) => r.kind === 'hazard').length,
    }),
  };
}
