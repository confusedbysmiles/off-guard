/**
 * Index for resolving `@UUID[...]` references to local entries.
 *
 * Two shapes appear in the corpus and both must work:
 *   Compendium.pf2e.conditionitems.Item.Frightened         (by name)
 *   Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei   (by id)
 * The id form is what the localized glossary strings use, so an index keyed only
 * by name would silently drop links inside every Grab, Regeneration and
 * Frightful Presence entry.
 */
import { listPacks, readPack, readJsonFromGit } from './packs.js';
import { COMPENDIUM_ALIASES, PACK_REF_KINDS } from './catalog.js';
import { slugify } from './markup.js';

/** Directory -> compendium names that can address it in a UUID. */
function compendiumNamesFor(pack) {
  const names = [pack];
  for (const [alias, dir] of Object.entries(COMPENDIUM_ALIASES)) {
    if (dir === pack) names.push(alias);
  }
  return names;
}

/**
 * Packs whose names win the global (pack-less) name key, most authoritative
 * first. Only matters when a UUID's pack segment is itself unresolvable.
 */
const GLOBAL_NAME_PRIORITY = [
  'conditions', 'actions', 'spells', 'equipment', 'feats',
  'bestiary-ability-glossary-srd', 'deities', 'heritages',
];

export function buildUuidIndex(upstream, { onProgress } = {}) {
  const index = new Map();
  const stats = { documents: 0, packs: 0 };

  const packs = listPacks(upstream);
  const ordered = [
    ...GLOBAL_NAME_PRIORITY.filter((p) => packs.includes(p)),
    ...packs.filter((p) => !GLOBAL_NAME_PRIORITY.includes(p)),
  ];

  for (const pack of ordered) {
    const kind = PACK_REF_KINDS[pack] ?? (pack.includes('bestiary') ? 'creature' : 'entry');
    const names = compendiumNamesFor(pack);
    let count = 0;

    for (const { doc } of readPack(upstream, pack)) {
      const name = doc.name;
      if (!name) continue;
      const slug = slugify(name);
      const entry = { kind, id: slug, name, pack, foundryId: doc._id ?? null };
      count += 1;

      for (const compendium of names) {
        index.set(`${compendium}:${slug}`, entry);
        if (doc._id) index.set(`${compendium}:${doc._id}`, entry);
      }
      if (doc._id && !index.has(`id:${doc._id}`)) index.set(`id:${doc._id}`, entry);
      if (!index.has(`name:${slug}`)) index.set(`name:${slug}`, entry);
    }

    stats.documents += count;
    stats.packs += 1;
    onProgress?.(pack, count);
  }

  // Upstream keeps a redirect table for entries that were renamed or moved
  // between packs. Applying it turns otherwise-dead links back into live ones.
  const redirects = readJsonFromGit(upstream, 'build/uuid-redirects/pf2e.json') ?? {};
  let redirected = 0;
  for (const [from, to] of Object.entries(redirects)) {
    const fromSegments = String(from).split('.');
    const toSegments = String(to).split('.');
    const target =
      index.get(`${toSegments.at(-3)}:${toSegments.at(-1)}`) ??
      index.get(`${toSegments.at(-3)}:${slugify(toSegments.at(-1))}`);
    if (!target) continue;
    const key = `${fromSegments.at(-3)}:${fromSegments.at(-1)}`;
    if (!index.has(key)) { index.set(key, target); redirected += 1; }
  }
  stats.redirects = redirected;

  // Renames the redirect table does not cover. Each entry is a reference that
  // still appears in creature text but whose target was renamed in the remaster.
  const RENAMES = { 'actionspf2e:disable-device': 'actionspf2e:disable-a-device' };
  for (const [from, to] of Object.entries(RENAMES)) {
    const target = index.get(to);
    if (target && !index.has(from)) index.set(from, target);
  }

  return { index, stats };
}
