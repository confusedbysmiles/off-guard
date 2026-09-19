/**
 * Options the GM wrote, in the shape the catalogue uses.
 *
 * `customBackground` let a player describe a background inside their own build
 * document. This is the other half of that idea: the GM writes one once, it
 * appears in every player's picker for that campaign, and a build points at it
 * by id exactly as it points at a background out of a book.
 *
 * Which means the record these functions produce has to be indistinguishable
 * from a catalogue record, because `deriveCharacter` and `slotsFor` are handed
 * it without being told where it came from. That constraint is the reason this
 * file is a pile of narrow clamps rather than a validator: every field is
 * built from scratch out of a value that has been checked against what the
 * rules can actually read, and anything unrecognised is dropped instead of
 * passed along. A `size` of "enormous" or a key attribute of "strength" would
 * otherwise reach the sheet and produce a blank where a number belongs.
 *
 * What is deliberately not here: anything a feat does. A homebrew class does
 * not grant its class features, for the same reason a catalogue one does not
 * -- see the note in `derive.js`. The numbers this file carries are the ones
 * the engine can compute and a player can check.
 */
import { ATTRIBUTES } from './attributes.js';
import { SKILLS } from './derive.js';
import { customBackground } from './background.js';

export const HOMEBREW_KINDS = ['ancestry', 'heritage', 'background', 'class'];

/**
 * A homebrew option's id.
 *
 * Namespaced by kind like every catalogue id, because a dozen places downstream
 * read the kind off the front of the id -- `stripKind` in the options module,
 * the `includes(':')` test in `builderState`, the heritage/ancestry match. The
 * distinguishing part is the row's primary key rather than a slug of the name,
 * so renaming an ancestry does not orphan the characters that chose it.
 */
export const homebrewId = (kind, rowId) => `${kind}:hb-${rowId}`;

export const isHomebrewId = (id) => /^[a-z]+:hb-\d+$/.test(String(id ?? ''));

/**
 * Where it came from, said the same way a book is.
 *
 * The picker prints `source.book` under every option it shows, so this is what
 * a player sees when they read one. "This table" rather than "Homebrew"
 * because it answers the question the player is actually asking, which is not
 * "is this official" but "is this ours".
 */
const SOURCE = Object.freeze({
  book: 'This table', pack: null, tier: null, remaster: true, license: null,
});

const SIZES = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large',
};

const VISION = ['normal', 'low-light-vision', 'darkvision'];

const RARITIES = ['common', 'uncommon', 'rare', 'unique'];

// --- the clamps ---------------------------------------------------------------

const text = (value, max = 60) => String(value ?? '').trim().slice(0, max);

const whole = (value, { min, max, fallback }) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const oneOf = (value, allowed, fallback) =>
  (allowed.includes(value) ? value : fallback);

/** A list of values from a fixed vocabulary, deduplicated, order kept. */
const listOf = (values, allowed, max = 12) =>
  [...new Set((Array.isArray(values) ? values : []).filter((v) => allowed.includes(v)))]
    .slice(0, max);

/**
 * Traits and languages are open vocabularies -- a setting's own language is
 * not in any list -- so they are cleaned rather than checked: lowercased,
 * trimmed, length-capped, and anything that is not a word dropped. The cap is
 * what stops a paste of an entire document becoming a trait.
 */
const openList = (values, max = 12) =>
  [...new Set((Array.isArray(values) ? values : [])
    .map((v) => text(v, 40).toLowerCase())
    .filter((v) => /^[a-z0-9][a-z0-9 '-]*$/.test(v)))]
    .slice(0, max);

/**
 * The GM's prose, as the description block every option carries.
 *
 * Escaped, not parsed. `description.html` is written into the page with
 * `innerHTML` -- it holds resolved markup for catalogue entries -- and the
 * content security policy would stop a script tag but not everything worth
 * stopping. Blank lines become paragraphs, which is the whole of the markup
 * anybody needs for "this is what the Ashen-Blooded are".
 */
export function describedAs(value) {
  const raw = String(value ?? '').trim().slice(0, 4000);
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    html: paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n'),
    text: raw,
    damage: [], checks: [], links: [], gmOnly: [], unresolved: [],
  };
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * The boosts an ancestry grants.
 *
 * Printed ancestries name some outright -- a dwarf's Constitution and Wisdom
 * -- and then offer one free. That is the whole of the pattern, so it is the
 * whole of the form: a list of attributes that are simply granted, and a count
 * of ones the player chooses. The handful of ancestries upstream that narrow a
 * free boost to two named attributes are not expressible here, and the honest
 * answer to that is to say so in the description rather than to grow the form
 * a dimension for a case that has never come up at this table.
 */
function boostsFrom(fixed, freeCount) {
  return [
    ...listOf(fixed, ATTRIBUTES, 6).map((attribute) => ({ free: false, options: [attribute] })),
    ...Array.from({ length: whole(freeCount, { min: 0, max: 4, fallback: 0 }) },
      () => ({ free: true, options: [...ATTRIBUTES] })),
  ];
}

// --- the four kinds -----------------------------------------------------------

function ancestryRecord(input) {
  const size = oneOf(input.size, Object.keys(SIZES), 'med');
  return {
    kind: 'ancestry',
    name: text(input.name) || 'Unnamed ancestry',
    level: 0,
    rarity: oneOf(input.rarity, RARITIES, 'common'),
    traits: openList(input.traits),
    description: describedAs(input.description),
    source: { ...SOURCE },
    hp: whole(input.hp, { min: 0, max: 20, fallback: 8 }),
    size,
    sizeName: SIZES[size],
    speed: whole(input.speed, { min: 0, max: 120, fallback: 25 }),
    reach: 5,
    boosts: boostsFrom(input.boosts, input.freeBoosts),
    flaws: listOf(input.flaws, ATTRIBUTES, 2),
    languages: openList(input.languages, 8),
    additionalLanguages: { count: 0, options: [] },
    vision: oneOf(input.vision, VISION, 'normal'),
    grants: [],
  };
}

/**
 * A heritage is almost nothing, mechanically.
 *
 * Its name reaches the sheet and everything else it does is a feature, which
 * this engine does not apply for catalogue heritages either. So the record is
 * a name, the ancestry it belongs to, and the prose -- and that is not a
 * simplification, that is the whole of what a heritage is to the arithmetic.
 *
 * `ancestry` holds the id with its kind stripped, which is the form the
 * catalogue stores and the form the picker's filter compares against. An empty
 * one is a versatile heritage: offered to every ancestry, which is exactly what
 * `search` does with a null.
 */
function heritageRecord(input, { ancestryOf }) {
  const parent = ancestryOf(input.ancestry);
  return {
    kind: 'heritage',
    name: text(input.name) || 'Unnamed heritage',
    level: 0,
    rarity: oneOf(input.rarity, RARITIES, 'common'),
    traits: openList(input.traits),
    description: describedAs(input.description),
    source: { ...SOURCE },
    ancestry: parent ? String(parent.id).replace(/^[a-z-]+:/, '') : null,
    ancestryName: parent?.name ?? null,
  };
}

/**
 * A background, which the player-side form already knows how to describe.
 *
 * Built by `customBackground` rather than rewritten here, so that a background
 * the GM published and one a player typed into their own build are the same
 * object with the same clamps -- and stay that way when one of them changes.
 * Only the provenance differs, and `custom` comes off because this one has an
 * id and lives in a picker.
 */
function backgroundRecord(input) {
  const { custom, id, source, ...record } = customBackground({
    name: input.name, boosts: input.boosts, skill: input.skill,
    lore: input.lore, feat: input.feat,
  }) ?? {};
  return {
    ...record,
    name: text(input.name) || 'Unnamed background',
    rarity: oneOf(input.rarity, RARITIES, 'common'),
    traits: openList(input.traits),
    description: describedAs(input.description),
    source: { ...SOURCE },
  };
}

/**
 * A class, which is the one that cannot be typed into a form.
 *
 * Everything else here is a handful of numbers. A class is an advancement
 * table: twenty levels of proficiency changes across perception, three saves,
 * five attack categories, four armour categories, the class DC and
 * spellcasting. Asking a GM to fill that in is asking them not to bother, and
 * getting one field wrong produces a character whose Will save is quietly one
 * rank low for six levels.
 *
 * So the table is copied from an existing class and the rest is overridden.
 * That matches what homebrew classes at a table actually are -- a reskin, a
 * variant, a class from a third-party book that advances like one of the core
 * twelve -- and it means the numbers are a published class's numbers rather
 * than a form's.
 *
 * Copied at the moment it is saved, not pointed at. If a data rebuild renames
 * or rebalances the class it was based on, a character who is already playing
 * this one does not silently change mid-campaign.
 */
function classRecord(input, { classOf, progressionOf }) {
  const base = classOf(input.basedOn);
  const copied = base ? progressionOf(base.id) : null;
  const initial = copied?.initial ?? base?.initial ?? BLANK_CLASS.initial;

  return {
    kind: 'class',
    name: text(input.name) || 'Unnamed class',
    level: 0,
    rarity: oneOf(input.rarity, RARITIES, 'common'),
    traits: openList(input.traits),
    description: describedAs(input.description),
    source: { ...SOURCE },
    hp: whole(input.hp, { min: 1, max: 20, fallback: base?.hp ?? 8 }),
    keyAttributes: listOf(input.keyAttributes, ATTRIBUTES, 6),
    initial,
    trainedSkills: {
      additional: whole(input.additionalSkills, {
        min: 0, max: 12, fallback: base?.trainedSkills?.additional ?? 3,
      }),
      fixed: listOf(input.fixedSkills, SKILLS, 16),
    },
    featLevels: base?.featLevels ?? BLANK_CLASS.featLevels,
    skillIncreaseLevels: base?.skillIncreaseLevels ?? BLANK_CLASS.skillIncreaseLevels,
    grants: [],
    /**
     * Carried on the record so the overlay can answer `progressionFor` without
     * the catalogue, and so it is visible in the saved document that this class
     * advances like a Fighter.
     *
     * Always present, even with nothing to copy: `byLevel` is then empty, which
     * is a class that starts where BLANK_CLASS says and never advances. Wrong
     * for a real class, but wrong in a way a level 7 sheet shows plainly rather
     * than a null that would quietly make every proficiency untrained.
     */
    basedOn: base ? { id: base.id, name: base.name } : null,
    progression: { initial, byLevel: copied?.byLevel ?? {} },
  };
}

/**
 * What a class looks like with nothing to copy: trained in nothing, feats on
 * the usual levels. A character built on it is visibly unfinished rather than
 * subtly wrong.
 */
const BLANK_CLASS = Object.freeze({
  initial: {
    perception: 'trained',
    saves: { fortitude: 'trained', reflex: 'trained', will: 'trained' },
    attacks: { unarmed: 'trained', simple: 'trained', martial: 'untrained', advanced: 'untrained', other: null },
    defenses: { unarmored: 'trained', light: 'untrained', medium: 'untrained', heavy: 'untrained' },
    classDc: 'trained',
    spellcasting: 'untrained',
  },
  featLevels: {
    class: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    ancestry: [1, 5, 9, 13, 17],
    general: [3, 7, 11, 15, 19],
    skill: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  },
  skillIncreaseLevels: [3, 5, 7, 9, 11, 13, 15, 17, 19],
});

const BUILDERS = {
  ancestry: ancestryRecord,
  heritage: heritageRecord,
  background: backgroundRecord,
  class: classRecord,
};

/**
 * The option document for one homebrew entry.
 *
 * No `id`: the id belongs to the database row, and the overlay stamps it on
 * the way out. A record that carried its own id would have two of them the
 * moment anybody copied a row.
 *
 * @param {string} kind    one of HOMEBREW_KINDS
 * @param {object} input   what the GM's form sent
 * @param {object} lookUps `classOf`, `ancestryOf` and `progressionOf`, which
 *                         are the catalogue -- passed in rather than imported
 *                         so this file stays arithmetic and the tests stay
 *                         cheap.
 */
export function homebrewRecord(kind, input = {}, lookUps = {}) {
  const build = BUILDERS[kind];
  if (!build) return null;
  return build(input ?? {}, {
    classOf: lookUps.classOf ?? (() => null),
    ancestryOf: lookUps.ancestryOf ?? (() => null),
    progressionOf: lookUps.progressionOf ?? (() => null),
  });
}

/**
 * The index row the picker's search runs over.
 *
 * The same shape `tools/build-data` emits for a catalogue option, plus
 * `homebrew: true` -- which is not a filter, it is a badge. A player looking at
 * a list of backgrounds should be able to see at a glance which one came from
 * their GM rather than from a book, without having to open it.
 */
export function homebrewRow(record, id) {
  const row = {
    id,
    kind: record.kind,
    name: record.name,
    search: record.name.toLowerCase(),
    level: 0,
    rarity: record.rarity,
    traits: record.traits ?? [],
    shard: null,
    book: SOURCE.book,
    pack: null,
    tier: null,
    remaster: true,
    homebrew: true,
  };
  // The two fields `search` filters on that are not common to every kind.
  if (record.kind === 'background') row.trainedSkills = record.trainedSkills ?? [];
  if (record.kind === 'heritage') row.ancestry = record.ancestry ?? null;
  return row;
}
