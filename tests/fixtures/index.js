/**
 * Loads the committed fixture set and runs it through the real normalizer.
 *
 * Deliberately independent of `npm run build:data`: the upstream documents, the
 * glossary strings they reference and the compendium entries their links point
 * at are all committed, so `npm test` works on a fresh clone.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkupResolver } from '../../tools/build-data/markup.js';
import { normalizeCreature } from '../../tools/build-data/normalize/creature.js';
import { normalizeHazard } from '../../tools/build-data/normalize/hazard.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const readJson = (p) => JSON.parse(readFileSync(join(HERE, p), 'utf8'));

export const manifest = readJson('manifest.json');

export function createFixtureResolver() {
  const glossary = new Map(Object.entries(readJson('glossary.json')));
  const uuidIndex = new Map(Object.entries(readJson('uuid-index.json')));
  return createMarkupResolver({ glossary, uuidIndex });
}

/** Raw upstream documents, keyed by the slug of their file name. */
export function loadRawFixtures() {
  const dir = join(HERE, 'upstream');
  const out = new Map();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const [pack, source] = file.split('__');
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    out.set(source.replace(/\.json$/, ''), { pack, doc });
  }
  return out;
}

/** Normalized records, keyed by id. */
export function loadFixtures() {
  const { resolve, localize } = createFixtureResolver();
  const creatures = new Map();
  const hazards = new Map();
  for (const [id, { pack, doc }] of loadRawFixtures()) {
    if (doc.type === 'npc') creatures.set(id, normalizeCreature(doc, { pack, resolve, localize, id }));
    else if (doc.type === 'hazard') hazards.set(id, normalizeHazard(doc, { pack, resolve, localize, id }));
  }
  return { creatures, hazards };
}
