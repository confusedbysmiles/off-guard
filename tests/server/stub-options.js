/**
 * A build-options catalogue of a handful of real records.
 *
 * Written to a temporary data directory and opened with the real `openOptions`,
 * rather than hand-built to the same shape: the loader's own sharding and index
 * lookup are worth exercising, and the records come from the pinned upstream so
 * the shapes are the ones the application will actually meet. The full
 * catalogue needs `npm run build:data` and 33 MB, which is not a test.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { openOptions } from '../../src/server/options.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/builder/options.json', import.meta.url), 'utf8'),
);

/** The same row shape `tools/build-data/options-build.js` emits. */
function indexRow(record, shard) {
  return {
    id: record.id, kind: record.kind, name: record.name,
    search: record.name.toLowerCase(), level: record.level, rarity: record.rarity,
    traits: record.traits ?? [], shard,
    book: record.source?.book ?? '', pack: record.source?.pack ?? '',
    tier: record.source?.tier ?? 'core', remaster: record.source?.remaster ?? true,
    ...(record.kind === 'heritage' ? { ancestry: record.ancestry } : {}),
    ...(record.kind === 'background' ? { trainedSkills: record.trainedSkills } : {}),
    ...(record.kind === 'equipment' ? {
      itemType: record.itemType, category: record.category, group: record.group,
    } : {}),
  };
}

export function stubOptions() {
  const dataDir = mkdtempSync(join(tmpdir(), 'off-guard-options-'));
  mkdirSync(resolve(dataDir, 'options'), { recursive: true });

  const rows = [];
  for (const kind of ['ancestry', 'heritage', 'background', 'class']) {
    const records = Object.values(FIXTURE[kind] ?? {});
    if (!records.length) continue;
    writeFileSync(resolve(dataDir, 'options', `${kind}.json`), JSON.stringify(records));
    for (const record of records) rows.push(indexRow(record, kind));
  }

  /**
   * Equipment shards by item type, as the real build does -- `equipment/weapon`
   * rather than one `equipment` file -- because that sharding is what makes one
   * question one file read, and a stub that flattened it would not exercise it.
   */
  mkdirSync(resolve(dataDir, 'options', 'equipment'), { recursive: true });
  const byType = new Map();
  for (const record of Object.values(FIXTURE.equipment ?? {})) {
    const shard = `equipment/${record.itemType}`;
    if (!byType.has(shard)) byType.set(shard, []);
    byType.get(shard).push(record);
    rows.push(indexRow(record, shard));
  }
  for (const [shard, records] of byType) {
    writeFileSync(resolve(dataDir, 'options', `${shard}.json`), JSON.stringify(records));
  }

  writeFileSync(resolve(dataDir, 'options-index.json'), JSON.stringify({
    generated: { commit: 'test' }, rows,
  }));
  writeFileSync(resolve(dataDir, 'class-progression.json'), JSON.stringify({
    generated: { commit: 'test' }, classes: FIXTURE.progression,
  }));

  return openOptions({ dataDir });
}

export { FIXTURE as OPTION_FIXTURE };
