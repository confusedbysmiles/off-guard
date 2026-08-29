/**
 * Pathbuilder 2e import.
 *
 * Maps a Pathbuilder export onto the Off-Guard sheet and produces a diff, which
 * is what the player confirms before anything is overwritten.
 *
 * Two rules make a re-import at level-up safe:
 *
 *   1. Only paths this mapper produces are ever proposed. Everything else --
 *      the free-text feats, features, reactions, items and notes sections --
 *      is invisible to the import and survives untouched.
 *   2. Play state is never proposed even though the mapper could produce it:
 *      current hit points, temporary hit points, conditions, hero points, spent
 *      spell slots and focus points. A level-up should not heal the character.
 *
 * The shape below is Pathbuilder's documented JSON export. Fields are read
 * defensively: an export missing a section produces a sheet missing that
 * section, never a thrown error mid-import.
 */

/** Paths the mapper can produce but must never overwrite on a re-import. */
export const PLAY_STATE_PATHS = new Set([
  'hp.current', 'hp.temp', 'conditions', 'heroPoints',
  'focus.current', 'spellcasting.slotsUsed',
]);

const RANK_BY_BONUS = { 0: 'untrained', 2: 'trained', 4: 'expert', 6: 'master', 8: 'legendary' };

/** Pathbuilder stores proficiency as the bonus it adds, not as a rank index. */
export function rankFromBonus(bonus) {
  return RANK_BY_BONUS[Number(bonus)] ?? 'untrained';
}

/** Pathbuilder stores attributes as scores; the sheet works in modifiers. */
export const modFromScore = (score) => Math.floor((Number(score) - 10) / 2);

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

const DAMAGE_TYPES = { B: 'bludgeoning', P: 'piercing', S: 'slashing' };

/**
 * @param {object} exported  the whole export, or its `build` object
 * @returns {{sheet: object, warnings: string[]}}
 */
export function mapPathbuilder(exported) {
  const build = exported?.build ?? exported;
  const warnings = [];
  if (!build || typeof build !== 'object') {
    return { sheet: {}, warnings: ['That file does not look like a Pathbuilder export.'] };
  }

  const abilities = build.abilities ?? {};
  const mods = {
    str: modFromScore(abilities.str ?? 10),
    dex: modFromScore(abilities.dex ?? 10),
    con: modFromScore(abilities.con ?? 10),
    int: modFromScore(abilities.int ?? 10),
    wis: modFromScore(abilities.wis ?? 10),
    cha: modFromScore(abilities.cha ?? 10),
  };

  const level = Number(build.level ?? 1);
  const prof = build.proficiencies ?? {};
  const attributes = build.attributes ?? {};

  // Pathbuilder gives the parts rather than the total, and Constitution is
  // applied per level, so the sum has to be done here.
  const hpMax = Number(attributes.ancestryhp ?? 0)
    + (Number(attributes.classhp ?? 0) + mods.con) * level
    + Number(attributes.bonushp ?? 0)
    + Number(attributes.bonushpPerLevel ?? 0) * level;

  const sheet = {
    name: build.name ?? '',
    level,
    ancestry: build.ancestry ?? '',
    heritage: build.heritage ?? '',
    background: build.background ?? '',
    class: build.class ?? '',
    subclass: subclassOf(build) ?? '',
    keyAttribute: String(build.keyability ?? '').toLowerCase(),
    size: build.sizeName ?? '',
    abilities: mods,
    classDc: { rank: rankFromBonus(prof.classDC) },
    perception: { rank: rankFromBonus(prof.perception) },
    saves: {
      fortitude: { rank: rankFromBonus(prof.fortitude) },
      reflex: { rank: rankFromBonus(prof.reflex) },
      will: { rank: rankFromBonus(prof.will) },
    },
    skills: Object.fromEntries(SKILLS.map((skill) => [skill, {
      rank: rankFromBonus(prof[skill]),
    }])),
    lores: (build.lores ?? []).map(([name, bonus]) => ({
      name: String(name ?? ''),
      rank: rankFromBonus(bonus),
    })),
    languages: build.languages ?? [],
    speed: Number(attributes.speed ?? 25) + Number(attributes.speedBonus ?? 0),
    hp: { max: hpMax },
    ac: mapArmorClass(build, mods),
    strikes: (build.weapons ?? []).map(mapWeapon),
    spellcasting: mapSpellcasting(build, warnings),
    focus: { pool: Number(build.focusPoints ?? 0) },
    resistances: build.resistances ?? [],
    // Deliberately absent, and therefore preserved on a re-import: feats,
    // features, reactions, items, notes.
  };

  if (build.dualClass) {
    warnings.push(`Dual class (${build.dualClass}) has no field on the sheet; it is noted here only.`);
  }
  if ((build.pets ?? []).length || (build.familiars ?? []).length) {
    warnings.push('Pets and familiars are not imported. Add them to the notes section.');
  }

  return { sheet, warnings };
}

/** Pathbuilder has no dedicated subclass field; it is named among the specials. */
function subclassOf(build) {
  const specials = build.specials ?? [];
  const known = /(Bloodline|Doctrine|Muse|Instinct|Racket|Order|Hunter's Edge|Research Field|Cause|Conscious Mind|Subconscious Mind|Deity|Way|Methodology|Innovation|Style|Domain|Patron|Element)/i;
  const match = specials.find((s) => known.test(String(s)));
  return match ? String(match) : null;
}

function mapArmorClass(build, mods) {
  const ac = build.acTotal ?? {};
  return {
    total: Number(ac.acTotal ?? 0) || null,
    itemBonus: Number(ac.acItemBonus ?? 0),
    dexCap: ac.acCheckPenalty === undefined && ac.dexCap === undefined
      ? null : Number(ac.dexCap ?? 0) || null,
    rank: rankFromBonus(ac.acProfBonus === undefined ? 0 : profFromAc(build, ac)),
    // The computed value is what the sheet shows; Pathbuilder's own total is
    // kept so a mismatch is visible rather than silently resolved.
    importedTotal: Number(ac.acTotal ?? 0) || null,
    dexMod: mods.dex,
  };
}

/** Which armour proficiency actually applied, from the armour Pathbuilder equipped. */
function profFromAc(build, ac) {
  const worn = (build.armor ?? []).find((a) => a.worn) ?? (build.armor ?? [])[0];
  const group = String(worn?.prof ?? 'unarmored').toLowerCase();
  const prof = build.proficiencies ?? {};
  return prof[group] ?? ac.acProfBonus ?? 0;
}

function mapWeapon(weapon) {
  const die = weapon.die ? String(weapon.die) : '';
  const bonus = Number(weapon.damageBonus ?? 0);
  const formula = die ? `1${die}${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ''}` : '';
  return {
    name: weapon.name ?? '',
    mod: Number(weapon.attack ?? 0),
    damage: formula,
    damageType: DAMAGE_TYPES[weapon.damageType] ?? String(weapon.damageType ?? '').toLowerCase(),
    traits: weapon.traits ?? [],
  };
}

function mapSpellcasting(build, warnings) {
  const casters = build.spellCasters ?? [];
  if (!casters.length) return [];
  return casters.map((caster) => {
    if (!caster.spells && !caster.prepared) {
      warnings.push(`${caster.name ?? 'A spellcasting entry'} has no spell list in the export.`);
    }
    return {
      name: caster.name ?? '',
      tradition: String(caster.magicTradition ?? '').toLowerCase(),
      kind: String(caster.spellcastingType ?? '').toLowerCase(),
      dc: Number(caster.spelldc ?? 0) || null,
      attackMod: Number(caster.spellattack ?? 0) || null,
      ranks: (caster.spells ?? []).map((entry) => ({
        rank: Number(entry.spellLevel ?? 0),
        spells: entry.list ?? [],
        slotsMax: Number(entry.slots ?? (entry.list ?? []).length) || 0,
      })),
    };
  });
}

/**
 * What an import would change.
 *
 * Only paths the mapper produced, only where the value differs, and never play
 * state. The result is what the confirmation screen renders; nothing is written
 * until the player accepts it.
 */
export function diffImport(currentSheet, importedSheet) {
  const changes = [];
  for (const path of leafPaths(importedSheet)) {
    if (PLAY_STATE_PATHS.has(path)) continue;
    const to = readPath(importedSheet, path);
    const from = readPath(currentSheet, path);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ path, from: from ?? null, to, isNew: from === undefined });
  }
  return changes;
}

export function leafPaths(object, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...leafPaths(value, path));
    else out.push(path);
  }
  return out;
}

export function readPath(object, path) {
  return String(path).split('.').reduce(
    (node, key) => (node === null || node === undefined ? undefined : node[key]),
    object,
  );
}
