/**
 * The build options pass.
 *
 * Runs inside `npm run build:data`, alongside the creature and hazard pass and
 * sharing its uuid index and markup resolver -- both are expensive to build and
 * neither depends on which packs are being read.
 *
 * Emits, under `data/options/`:
 *
 *   ancestry.json heritage.json background.json class.json deity.json
 *   action.json feature.json           one file each; all are small
 *   feat/<category>.json               6,284 feats, sharded by what slot they fill
 *   equipment/<type>.json              armour, weapons and shields split from gear
 *   spell/rank-<n>.json                sharded by rank, which is how they are chosen
 *
 * and `data/options-index.json`, one flat row per option: the whole search
 * index, scanned linearly on the server exactly as the creature index is.
 *
 * Sharding is by the axis the builder actually filters on, so answering "what
 * class feats can a level 6 fighter take" is one file read rather than sixty.
 */
import { readPack } from './packs.js';
import { slugify } from './markup.js';
import { isOptionDocument, normalizeOption } from './normalize/option.js';
import { progressionFor } from './progression.js';

/** Packs holding things a player chooses, and what each contributes. */
export const OPTION_PACKS = [
  'ancestries', 'heritages', 'backgrounds', 'classes',
  'class-features', 'ancestry-features',
  'feats', 'equipment', 'spells', 'actions', 'deities',
];

/**
 * Which file a record lands in. The key doubles as the path under
 * `data/options/`, so a shard is a directory only where it needs to be.
 */
function shardFor(record) {
  switch (record.kind) {
    case 'feat': return `feat/${record.category || 'other'}`;
    case 'feature': return 'feature';
    case 'equipment': return `equipment/${record.itemType}`;
    case 'spell': return `spell/rank-${record.rank}`;
    default: return record.kind;
  }
}

/**
 * One search row. Deliberately wider than the creature index: a builder filters
 * on things a bestiary never does -- which class a feat belongs to, which
 * ancestry a heritage is for, which tradition a spell is on.
 */
function indexRow(record, shard) {
  const row = {
    id: record.id,
    kind: record.kind,
    name: record.name,
    search: record.name.toLowerCase(),
    level: record.level,
    rarity: record.rarity,
    traits: record.traits,
    shard,
    book: record.source.book,
    pack: record.source.pack,
    tier: record.source.tier,
    remaster: record.source.remaster,
  };

  if (record.kind === 'feat' || record.kind === 'feature') {
    row.category = record.category;
    // Whether the feat has prerequisites at all is a filter of its own: "show
    // me what I can take right now" is the question a builder is asked most.
    row.hasPrerequisites = record.prerequisites.length > 0;
    row.actionCost = record.actionCost?.type ?? 'passive';
  }
  if (record.kind === 'heritage') row.ancestry = record.ancestry;
  if (record.kind === 'spell') {
    row.rank = record.rank;
    row.traditions = record.traditions;
  }
  if (record.kind === 'equipment') {
    row.itemType = record.itemType;
    row.category = record.category;
    row.group = record.group;
  }
  if (record.kind === 'background') row.trainedSkills = record.trainedSkills;
  return row;
}

/**
 * Build every option record.
 *
 * Ids collide far less than creature ids do -- a feat and a creature rarely
 * share a name -- but they collide across *kinds* often ("Shield Block" is a
 * class feature and a feat), so ids are namespaced by kind rather than
 * disambiguated by pack. `feat:shield-block` and `feature:shield-block` are
 * different things and the builder needs to link to each.
 */
export function buildOptions({ upstream, resolve, log = () => {} }) {
  const shards = new Map();
  const rows = [];
  const report = {
    counts: {},
    progression: { classes: 0, unmapped: [], deferred: [] },
    duplicateIds: [],
  };

  const seen = new Set();
  const classRecords = [];

  for (const pack of OPTION_PACKS) {
    let count = 0;
    for (const { doc } of readPack(upstream, pack)) {
      if (!isOptionDocument(doc)) continue;

      // Namespaced, so a feat and a class feature of the same name coexist.
      const provisionalKind = doc.type === 'feat'
        ? (String(doc.system?.category ?? '').endsWith('feature') ? 'feature' : 'feat')
        : (['armor', 'weapon', 'shield', 'equipment', 'consumable', 'treasure', 'backpack', 'ammo', 'kit']
          .includes(doc.type) ? 'equipment' : doc.type);
      let id = `${provisionalKind}:${slugify(doc.name)}`;
      if (seen.has(id)) {
        // A genuine duplicate name inside one kind. Suffix rather than drop:
        // two different feats called the same thing are both takeable.
        let n = 2;
        while (seen.has(`${id}-${n}`)) n += 1;
        report.duplicateIds.push({ id, resolvedAs: `${id}-${n}`, name: doc.name, pack });
        id = `${id}-${n}`;
      }
      seen.add(id);

      const record = normalizeOption(doc, { id, pack, resolve });
      if (!record) continue;

      const shard = shardFor(record);
      if (!shards.has(shard)) shards.set(shard, []);
      shards.get(shard).push(record);
      rows.push(indexRow(record, shard));
      if (record.kind === 'class') classRecords.push(record);
      count += 1;
    }
    report.counts[pack] = count;
    log(`  ${pack.padEnd(20)} ${String(count).padStart(5)} options`);
  }

  /**
   * Fold each class's granted features into a level-indexed advancement table.
   * What could not be mapped is reported, never guessed -- an unrecognized
   * feature leaves a proficiency flat rather than moving it to the wrong rank.
   */
  const progression = {};
  for (const record of classRecords) {
    const { byLevel, unmapped, deferred } = progressionFor(record);
    progression[record.id] = {
      id: record.id,
      name: record.name,
      initial: record.initial,
      byLevel,
    };
    report.progression.unmapped.push(...unmapped);
    report.progression.deferred.push(...deferred);
  }
  report.progression.classes = classRecords.length;

  return { shards, rows, progression, report };
}
