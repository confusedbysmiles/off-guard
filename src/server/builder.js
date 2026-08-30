/**
 * The builder, server side.
 *
 * Three jobs, and the third is the one that matters: resolve the option records
 * a build points at, derive a sheet from them, and turn that sheet into the
 * same field writes any other edit produces.
 *
 * That last step is what makes the builder integrate rather than sit beside
 * everything. A build change is not a special kind of update -- it goes through
 * `applyPatch` like a player typing a note or a GM pushing a condition, so it
 * is versioned per field, it reaches the live stream, and the GM's party panel
 * sees it without knowing the builder exists.
 *
 * The build document itself lives at `sheet.build` and is written as one path.
 * Splitting it into leaves would buy per-field version tracking on choices only
 * one person ever makes -- a character has exactly one player -- at the cost of
 * a hundred paths per character in `character_field`.
 */
import { deriveCharacter } from '../rules/character/derive.js';
import { slotsFor, outstanding } from '../rules/character/slots.js';
import { readPath } from './store/characters.js';

/** An empty build, so a character that has never been built still has a shape. */
export const blankBuild = () => ({
  version: 1,
  level: 1,
  ancestry: null,
  heritage: null,
  background: null,
  class: null,
  attributes: { ancestry: [], background: [], class: null, 1: [], 5: [], 10: [], 15: [], 20: [] },
  skills: { trained: [], increases: {}, lores: [] },
  feats: {},
});

/**
 * The records a build refers to.
 *
 * Missing ones come back null rather than throwing: a half-built character is
 * the normal state of one being built, and a build that names an option the
 * catalogue no longer has -- a renamed feat after an upstream bump -- should
 * degrade to "that choice is gone" rather than to a 500.
 */
export function resolveBuild(options, build = {}) {
  const klass = build.class ? options.get(build.class) : null;

  // Every equipment record the build names, in one pass, keyed by id. The
  // derivation looks items up rather than being handed them in order, so a
  // weapon listed twice costs one read.
  const items = {};
  const wanted = [
    build.equipment?.armor?.id,
    build.equipment?.shield?.id,
    ...(build.equipment?.weapons ?? []).map((w) => w?.id),
  ].filter(Boolean);
  for (const id of new Set(wanted)) {
    const record = options.get(id);
    if (record) items[id] = record;
  }

  return {
    items,
    ancestry: build.ancestry ? options.get(build.ancestry) : null,
    heritage: build.heritage ? options.get(build.heritage) : null,
    background: build.background ? options.get(build.background) : null,
    klass,
    progression: build.class ? options.progressionFor(build.class) : null,
  };
}

/**
 * Everything the builder screen needs: the derived sheet, the timeline, what is
 * still unchosen, and which named options could not be resolved.
 */
export function builderState(options, build = {}) {
  const resolved = resolveBuild(options, build);
  const derived = deriveCharacter(build, resolved);
  const { slots, byLevel, level, planTo } = slotsFor(build, {
    ...resolved,
    intMod: derived.sheet.abilities?.int ?? 0,
  });

  /**
   * The printed name beside every filled slot.
   *
   * Resolved here rather than fetched by the interface: a level 12 character
   * has thirty-odd filled slots, and thirty requests to turn ids into names
   * before the page can render is not a page, it is a progress bar.
   */
  for (const slot of slots) {
    if (typeof slot.filled !== 'string' || !slot.filled.includes(':')) continue;
    const record = options.get(slot.filled);
    slot.filledName = record?.name ?? null;
    slot.filledLevel = record?.level ?? null;
    // A choice whose option has gone is worth showing as a gap rather than as
    // a blank that looks filled.
    slot.filledMissing = !record;
  }

  const missing = [];
  for (const [field, id] of [
    ['ancestry', build.ancestry], ['heritage', build.heritage],
    ['background', build.background], ['class', build.class],
  ]) {
    if (id && !resolved[field === 'class' ? 'klass' : field]) {
      missing.push({ field, id, message: `This build names ${id}, which is not in the catalogue.` });
    }
  }

  return {
    build,
    ...derived,
    /**
     * The equipment records the build names, trimmed to what the interface
     * shows. Sent with the state for the same reason slot names are: turning
     * ids into names is otherwise a request per item before the page can draw.
     */
    items: Object.fromEntries(Object.entries(resolved.items ?? {}).map(([id, record]) => [id, {
      id,
      name: record.name,
      itemType: record.itemType,
      category: record.category,
      level: record.level,
    }])),
    slots,
    byLevel,
    level,
    planTo,
    outstanding: outstanding(slots, level).length,
    missing,
  };
}

/**
 * The writes a build change produces.
 *
 * The build document, then every path the derivation owns. Play state is not
 * among them -- see `DERIVED_PATHS` -- so rebuilding a character no more heals
 * them than re-importing one does.
 *
 * Values identical to what is already on the sheet are dropped. Without that,
 * every keystroke in the builder would bump the version of all forty derived
 * paths, and the live stream would push a full sheet to the player's phone each
 * time they scrolled a list.
 */
export function buildWrites(build, derived, currentSheet = {}) {
  const writes = [{ path: 'build', value: build }];

  for (const [path, value] of flatten(derived.sheet)) {
    const current = readPath(currentSheet, path);
    if (JSON.stringify(current) === JSON.stringify(value)) continue;
    writes.push({ path, value });
  }

  return writes;
}

/** Dotted paths to every non-object value. Arrays are leaves, as everywhere else. */
function* flatten(object, prefix = '') {
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) yield* flatten(value, path);
    else yield [path, value];
  }
}

/**
 * Reject a build that is not a plain object before anything reads it.
 * The client is trusted to be the player's own browser, not to be well-behaved.
 */
export function validBuild(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
