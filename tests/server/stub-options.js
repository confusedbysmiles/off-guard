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

  writeFileSync(resolve(dataDir, 'options-index.json'), JSON.stringify({
    generated: { commit: 'test' }, rows,
  }));
  writeFileSync(resolve(dataDir, 'class-progression.json'), JSON.stringify({
    generated: { commit: 'test' }, classes: FIXTURE.progression,
  }));

  return openOptions({ dataDir });
}

export { FIXTURE as OPTION_FIXTURE };
