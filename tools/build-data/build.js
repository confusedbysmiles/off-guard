#!/usr/bin/env node
/**
 * `npm run build:data`
 *
 * Turns the pinned foundryvtt/pf2e checkout into Off-Guard's local creature and
 * hazard catalogue. Emits:
 *
 *   data/creatures/<pack>.json   normalized creature records, one file per pack
 *   data/hazards/<pack>.json     normalized hazard records
 *   data/index.json              one flat row per entry; the whole search index
 *   data/traits.json             trait vocabulary with counts, for filter UI
 *   data/build-report.json       diagnostics: unresolved links, untyped creatures
 *
 * The search index is a flat array scanned linearly. At ~7,600 rows that is well
 * under a millisecond in a browser, and it is readable two years from now, which
 * a trigram index would not be.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { ensureUpstream, LOCK, PROJECT_ROOT } from './upstream.js';
import { listPacks, readPack } from './packs.js';
import { buildUuidIndex } from './uuid-index.js';
import { loadGlossary } from './glossary.js';
import { createMarkupResolver, slugify } from './markup.js';
import { isCreaturePack, packTier } from './catalog.js';
import { normalizeCreature } from './normalize/creature.js';
import { normalizeHazard } from './normalize/hazard.js';

const DATA_DIR = resolvePath(PROJECT_ROOT, 'data');

/**
 * Pack order decides who wins the clean slug when two books print the same
 * creature. Remaster core first, per the "remaster wins by default" rule: the
 * legacy entry keeps a suffixed id and is marked superseded.
 */
const ID_PRIORITY = [
  'pathfinder-monster-core',
  'pathfinder-monster-core-2',
  'pathfinder-npc-core',
  'hazards',
  'pathfinder-bestiary',
  'pathfinder-bestiary-2',
  'pathfinder-bestiary-3',
];

function orderPacks(packs) {
  const rest = packs.filter((p) => !ID_PRIORITY.includes(p)).sort();
  return [...ID_PRIORITY.filter((p) => packs.includes(p)), ...rest];
}

/**
 * Suffix for disambiguating a colliding slug. Spelled out rather than initialled
 * (`barghest-bestiary`, not `barghest-pat`) because these ids end up in URLs and
 * in the API, and an abbreviation nobody can decode is a two-year-from-now tax.
 */
function packSuffix(pack) {
  return pack.replace(/^pathfinder-/, '').replace(/-bestiary$/, '') || pack;
}

function main() {
  const started = Date.now();
  const upstream = ensureUpstream();

  process.stdout.write('Indexing compendium references... ');
  const { index: uuidIndex, stats: indexStats } = buildUuidIndex(upstream);
  console.log(`${uuidIndex.size} keys from ${indexStats.documents} documents (${indexStats.redirects} redirects)`);

  const glossary = loadGlossary(upstream);
  console.log(`Loaded ${glossary.size} localization strings.`);

  const { resolve, localize } = createMarkupResolver({ uuidIndex, glossary });

  const packs = orderPacks(listPacks(upstream).filter(isCreaturePack));
  const takenIds = new Map();
  const creaturesByPack = new Map();
  const hazardsByPack = new Map();
  const rows = [];
  const report = {
    upstream: { repo: LOCK.repo, commit: LOCK.commit },
    counts: { creatures: 0, hazards: 0, packs: 0 },
    unresolvedLinks: {},
    unresolvedLocalize: {},
    creaturesWithoutType: [],
    superseded: [],
    idCollisions: 0,
  };

  /** Assign a stable id; remaster core claims the bare slug, others get suffixed. */
  function assignId(name, pack, kind, remaster) {
    const base = slugify(name);
    const claim = { pack, name, kind, remaster };
    if (!takenIds.has(base)) {
      takenIds.set(base, claim);
      return { id: base, claimant: null };
    }
    report.idCollisions += 1;
    let candidate = `${base}-${packSuffix(pack)}`;
    let n = 2;
    while (takenIds.has(candidate)) { candidate = `${base}-${packSuffix(pack)}-${n}`; n += 1; }
    takenIds.set(candidate, claim);
    return { id: candidate, claimant: { key: base, ...takenIds.get(base) } };
  }

  for (const pack of packs) {
    const creatures = [];
    const hazards = [];

    for (const { doc } of readPack(upstream, pack)) {
      if (doc.type !== 'npc' && doc.type !== 'hazard') continue;
      const kind = doc.type === 'npc' ? 'creature' : 'hazard';
      const remastered = doc.system?.details?.publication?.remaster ?? false;
      const { id, claimant } = assignId(doc.name, pack, kind, remastered);
      const record = kind === 'creature'
        ? normalizeCreature(doc, { pack, resolve, localize, id })
        : normalizeHazard(doc, { pack, resolve, localize, id });

      // A same-named entry already claimed the bare slug. That is a remaster
      // reprint only when the claimant is the *same kind* and *is* remastered —
      // a hazard and a creature sharing a name supersede nothing.
      if (claimant && claimant.kind === kind && claimant.remaster && !remastered) {
        record.supersededBy = claimant.key;
        report.superseded.push({ id, supersededBy: claimant.key, name: record.name });
      }

      harvestDiagnostics(record, report);

      if (doc.type === 'npc') {
        creatures.push(record);
        if (!record.creatureType) report.creaturesWithoutType.push(id);
      } else {
        hazards.push(record);
      }

      rows.push(indexRow(record, doc.type === 'npc' ? 'creature' : 'hazard'));
    }

    if (creatures.length) creaturesByPack.set(pack, creatures);
    if (hazards.length) hazardsByPack.set(pack, hazards);
    report.counts.creatures += creatures.length;
    report.counts.hazards += hazards.length;
    report.counts.packs += 1;
    console.log(
      `  ${pack.padEnd(40)} ${String(creatures.length).padStart(4)} creatures` +
      (hazards.length ? `  ${hazards.length} hazards` : '')
    );
  }

  writeOutputs({ creaturesByPack, hazardsByPack, rows, report, started });
}

/**
 * Walk every RichText on a record, tally what the resolver could not resolve,
 * then strip the build-only fields. `unresolved` is a diagnostic and `links`
 * duplicates the anchors already in `html`; neither belongs in shipped data.
 */
function harvestDiagnostics(record, report) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Array.isArray(node.unresolved) && typeof node.html === 'string') {
      for (const ref of node.unresolved) {
        const bucket = ref.startsWith('PF2E.') ? report.unresolvedLocalize : report.unresolvedLinks;
        bucket[ref] = (bucket[ref] ?? 0) + 1;
      }
      delete node.unresolved;
      delete node.links;
      if (!node.gmOnly) delete node.gmOnly;
      if (!node.damage.length) delete node.damage;
      if (!node.checks.length) delete node.checks;
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(record);
}

/** One search row. Readable keys on purpose: gzip makes the terseness pointless. */
function indexRow(record, kind) {
  return {
    id: record.id,
    kind,
    name: record.name,
    search: record.name.toLowerCase(),
    level: record.level,
    rarity: record.rarity,
    size: kind === 'creature' ? record.size?.code ?? null : null,
    creatureType: kind === 'creature' ? record.creatureType : null,
    complex: kind === 'hazard' ? record.complex : null,
    traits: record.traits,
    book: record.source.book,
    pack: record.source.pack,
    tier: record.source.tier,
    remaster: record.source.remaster,
    supersededBy: record.supersededBy ?? null,
  };
}

function writeOutputs({ creaturesByPack, hazardsByPack, rows, report, started }) {
  rmSync(resolvePath(DATA_DIR, 'creatures'), { recursive: true, force: true });
  rmSync(resolvePath(DATA_DIR, 'hazards'), { recursive: true, force: true });
  mkdirSync(resolvePath(DATA_DIR, 'creatures'), { recursive: true });
  mkdirSync(resolvePath(DATA_DIR, 'hazards'), { recursive: true });

  let bytes = 0;
  const write = (path, value) => {
    const json = JSON.stringify(value);
    bytes += Buffer.byteLength(json);
    writeFileSync(resolvePath(DATA_DIR, path), json);
  };

  for (const [pack, records] of creaturesByPack) write(`creatures/${pack}.json`, records);
  for (const [pack, records] of hazardsByPack) write(`hazards/${pack}.json`, records);

  const traits = new Map();
  for (const row of rows) for (const t of row.traits) traits.set(t, (traits.get(t) ?? 0) + 1);

  write('index.json', {
    generated: { commit: report.upstream.commit },
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
  });
  write('traits.json', [...traits.entries()]
    .map(([trait, count]) => ({ trait, count }))
    .sort((a, b) => b.count - a.count || a.trait.localeCompare(b.trait)));

  report.durationMs = Date.now() - started;
  report.bytes = bytes;
  report.unresolvedLinks = topEntries(report.unresolvedLinks);
  report.unresolvedLocalize = topEntries(report.unresolvedLocalize);
  writeFileSync(
    resolvePath(DATA_DIR, 'build-report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );

  console.log('');
  console.log(`Creatures: ${report.counts.creatures}   Hazards: ${report.counts.hazards}`);
  console.log(`Id collisions: ${report.idCollisions}   Superseded by remaster: ${report.superseded.length}`);
  console.log(`Creatures with no type trait: ${report.creaturesWithoutType.length}`);
  console.log(`Unresolved links: ${sumCounts(report.unresolvedLinks)}   Unresolved @Localize: ${sumCounts(report.unresolvedLocalize)}`);
  console.log(`Wrote ${(bytes / 1_000_000).toFixed(1)} MB in ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log('Diagnostics: data/build-report.json');
}

const sumCounts = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

/** Keep the report readable: the long tail of one-off misses helps nobody. */
function topEntries(counts, limit = 40) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit)
  );
}

main();
