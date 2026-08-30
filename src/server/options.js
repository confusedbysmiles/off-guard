/**
 * The build-options catalogue.
 *
 * The same shape as the creature catalogue and for the same reasons: search
 * runs on the server, the index is a flat array scanned linearly, and a clone
 * that has not run `npm run build:data` starts anyway and says the catalogue is
 * missing rather than failing in a way that looks like a bug.
 *
 * It is bigger than the creature index -- 17,000 rows against 7,600 -- and
 * matters more per keystroke, because a player choosing a level 6 class feat is
 * typing into a filtered list rather than looking up one monster. The filters
 * do the heavy lifting: narrowing to `category: 'class'` and the class's own
 * trait takes 6,283 feats down to a few dozen before the name is even read.
 *
 * Global across campaigns, like the creature catalogue. Rules content is not a
 * table's property.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');

/** What an absent data build looks like, so every caller has one shape to handle. */
function unavailable(reason) {
  return {
    available: false,
    reason,
    search: () => ({ rows: [], total: 0, available: false }),
    get: () => null,
    getMany: () => [],
    has: () => false,
    progressionFor: () => null,
    classes: () => [],
    stats: () => ({ available: false, reason }),
  };
}

export function openOptions({ dataDir = DATA_DIR } = {}) {
  const indexFile = resolve(dataDir, 'options-index.json');
  if (!existsSync(indexFile)) {
    return unavailable('No build options. Run `npm run build:data`.');
  }

  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const rows = index.rows ?? [];
  const rowById = new Map(rows.map((row) => [row.id, row]));

  const shardCache = new Map();
  function loadShard(shard) {
    if (!shardCache.has(shard)) {
      const file = resolve(dataDir, 'options', `${shard}.json`);
      if (!existsSync(file)) return new Map();
      const entries = JSON.parse(readFileSync(file, 'utf8'));
      shardCache.set(shard, new Map(entries.map((entry) => [entry.id, entry])));
    }
    return shardCache.get(shard);
  }

  const progressionFile = resolve(dataDir, 'class-progression.json');
  const progression = existsSync(progressionFile)
    ? JSON.parse(readFileSync(progressionFile, 'utf8')).classes ?? {}
    : {};

  /**
   * Search.
   *
   * `maxLevel` rather than a range, because the question a builder asks is
   * always "what may I take", never "what is exactly level 6". A level 2 feat
   * is a perfectly good choice for a level 6 slot.
   */
  function search({
    q = '', kind = null, category = null, trait = null, traits = [],
    maxLevel = null, minLevel = null, rarity = null, tradition = null,
    ancestry = null, itemType = null, source = null, remasterOnly = false,
    skill = null, limit = 50, offset = 0, sort = 'name',
  } = {}) {
    const needle = String(q ?? '').trim().toLowerCase();
    const wanted = [trait, ...(traits ?? [])].filter(Boolean).map((t) => String(t).toLowerCase());

    const matched = rows.filter((row) => {
      if (kind && row.kind !== kind) return false;
      if (category && row.category !== category) return false;
      if (itemType && row.itemType !== itemType) return false;
      if (needle && !row.search.includes(needle)) return false;
      if (maxLevel !== null && row.level > Number(maxLevel)) return false;
      if (minLevel !== null && row.level < Number(minLevel)) return false;
      if (rarity && row.rarity !== rarity) return false;
      if (source && row.book !== source) return false;
      if (remasterOnly && !row.remaster) return false;
      if (tradition && !(row.traditions ?? []).includes(tradition)) return false;
      if (skill && !(row.trainedSkills ?? []).includes(skill)) return false;

      /**
       * A heritage names the ancestry it belongs to; a versatile heritage names
       * none and is offered to everyone. Filtering those out would hide half a
       * dwarf's legitimate choices.
       */
      if (ancestry && row.kind === 'heritage' && row.ancestry !== null) {
        if (row.ancestry !== stripKind(ancestry)) return false;
      }

      for (const t of wanted) if (!(row.traits ?? []).includes(t)) return false;
      return true;
    });

    /**
     * `rarity` is the default the builder wants and `name` is not: sorted
     * alphabetically, a player opening the ancestry list meets Anadi, Android,
     * Athamaru and Automaton before Dwarf, Elf or Human. Common first, then by
     * name, puts the fifty options most characters use at the top without
     * hiding the rest behind a filter.
     */
    const compare = {
      name: (a, b) => a.name.localeCompare(b.name),
      rarity: (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
        || a.name.localeCompare(b.name),
      level: (a, b) => a.level - b.level || a.name.localeCompare(b.name),
      'level-desc': (a, b) => b.level - a.level || a.name.localeCompare(b.name),
    }[sort] ?? ((a, b) => a.name.localeCompare(b.name));

    matched.sort(compare);

    return {
      available: true,
      total: matched.length,
      rows: matched.slice(Number(offset), Number(offset) + Number(limit)),
    };
  }

  function get(id) {
    const row = rowById.get(id);
    if (!row) return null;
    return loadShard(row.shard).get(id) ?? null;
  }

  /**
   * Several records at once.
   *
   * The builder always needs a handful together -- the ancestry, heritage,
   * background and class a character is made of -- and doing that as four
   * requests would mean four round trips before a sheet could be derived.
   */
  function getMany(ids = []) {
    return ids.map((id) => get(id)).filter(Boolean);
  }

  return {
    available: true,
    reason: null,
    search,
    get,
    getMany,
    has: (id) => rowById.has(id),
    /** A class's advancement table, folded at build time from what it grants. */
    progressionFor: (id) => progression[id] ?? null,
    classes: () => rows.filter((row) => row.kind === 'class')
      .map((row) => ({ id: row.id, name: row.name, rarity: row.rarity, book: row.book }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stats: () => ({
      available: true,
      commit: index.generated?.commit ?? null,
      total: rows.length,
      byKind: rows.reduce((counts, row) => {
        counts[row.kind] = (counts[row.kind] ?? 0) + 1;
        return counts;
      }, {}),
      classes: Object.keys(progression).length,
    }),
  };
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'unique'];

/** Ids are namespaced (`ancestry:dwarf`); a heritage's `ancestry` field is not. */
const stripKind = (id) => String(id ?? '').replace(/^[a-z-]+:/, '');
