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
  const itemBonuses = skillItemBonuses(build, warnings);

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
      ...(itemBonuses[skill] ?? {}),
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

  const shieldBonus = Number(build.acTotal?.shieldBonus ?? 0);
  if (shieldBonus) {
    warnings.push(
      `A shield worth +${shieldBonus} AC is equipped. The sheet has no shield field, `
      + 'so raising it is a note rather than a number.',
    );
  }

  const specific = build.specificProficiencies ?? {};
  if (Object.values(specific).some((list) => (list ?? []).length)) {
    warnings.push(
      'Proficiencies in specific weapons or armour are not imported; the sheet '
      + 'records one rank per category.',
    );
  }

  // Pathbuilder gives `attack` as a full total, so `damageBonus` is most likely
  // one too -- but nothing in the export says so, and a character who should be
  // adding Strength to damage and is not would look merely unlucky rather than
  // wrong. Say so, and only when it could actually be hiding something.
  const weapons = build.weapons ?? [];
  if (weapons.length && mods.str > 0 && weapons.every((w) => !Number(w.damageBonus))) {
    warnings.push(
      'No weapon has a damage bonus, though this character has a positive Strength '
      + 'modifier. Pathbuilder does not export weapon traits, so whether Strength '
      + 'applies to each weapon is a judgement only you can make -- check the damage.',
    );
  }

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
    dexCap: dexCapFrom(ac, mods),
    rank: rankFromBonus(ac.acProfBonus === undefined ? 0 : profFromAc(build, ac)),
    // The computed value is what the sheet shows; Pathbuilder's own total is
    // kept so a mismatch is visible rather than silently resolved.
    importedTotal: Number(ac.acTotal ?? 0) || null,
    dexMod: mods.dex,
  };
}

/**
 * The armour's Dexterity cap.
 *
 * The export has no field for it -- but it has `acAbilityBonus`, which is the
 * Dexterity that actually reached the AC. If that is less than the character's
 * Dexterity modifier, the armour capped it, and by exactly that much. Deriving
 * it is exact; assuming there is no cap silently gives a plate-armoured
 * character with high Dexterity an AC two or three points too high.
 */
function dexCapFrom(ac, mods) {
  if (ac.acAbilityBonus === undefined) return null;
  const applied = Number(ac.acAbilityBonus);
  return applied < mods.dex ? applied : null;
}

/** Which armour proficiency actually applied, from the armour Pathbuilder equipped. */
function profFromAc(build, ac) {
  const worn = (build.armor ?? []).find((a) => a.worn) ?? (build.armor ?? [])[0];
  const group = String(worn?.prof ?? 'unarmored').toLowerCase();
  const prof = build.proficiencies ?? {};
  return prof[group] ?? ac.acProfBonus ?? 0;
}

/**
 * Striking runes, by the value Pathbuilder puts in `str`.
 * A striking rune adds dice rather than a bonus, so a level 6 character's
 * longsword is 2d8, not 1d8 -- getting this wrong halves everyone's damage.
 */
const STRIKING_DICE = {
  '': 1, striking: 2, greaterStriking: 3, majorStriking: 4,
};

/** One step up the damage die ladder, for `increasedDice`. */
const NEXT_DIE = { d4: 'd6', d6: 'd8', d8: 'd10', d10: 'd12', d12: 'd12' };

function mapWeapon(weapon) {
  let die = weapon.die ? String(weapon.die) : '';
  if (die && weapon.increasedDice) die = NEXT_DIE[die] ?? die;

  const count = STRIKING_DICE[String(weapon.str ?? '')] ?? 1;
  const bonus = Number(weapon.damageBonus ?? 0);
  const base = die
    ? `${count}${die}${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ''}`
    : '';

  // Sneak attack and rune damage come through as free text: `2d6 precision`.
  const extra = (weapon.extraDamage ?? []).filter(Boolean).map(String);
  const formula = [base, ...extra].filter(Boolean).join(' plus ');

  // Runes and material live in the display name and in `runes`; the sheet has
  // one free-text traits field, which is where a player would type them anyway.
  const traits = [...(weapon.runes ?? []), weapon.mat].filter(Boolean).map(String);

  return {
    // `display` is what the player calls it -- "+1 Striking Returning Dagger" --
    // and `name` is the bare weapon underneath it.
    name: String(weapon.display || weapon.name || ''),
    mod: Number(weapon.attack ?? 0),
    damage: formula,
    damageType: DAMAGE_TYPES[weapon.damageType] ?? String(weapon.damageType ?? '').toLowerCase(),
    traitsText: traits.join(', '),
  };
}

/**
 * Item bonuses, from Pathbuilder's `mods`.
 *
 * Shaped `{ "Diplomacy": { "Item Bonus": 1 } }`, keyed by display name. Dropping
 * these silently makes the sheet disagree with Pathbuilder by a point or two on
 * exactly the skills the player invested in an item for.
 */
function skillItemBonuses(build, warnings) {
  const mods = build.mods ?? {};
  const bonuses = {};
  const unmapped = [];

  for (const [name, entries] of Object.entries(mods)) {
    const key = String(name).toLowerCase();
    const item = Number(entries?.['Item Bonus'] ?? 0);
    const other = Object.entries(entries ?? {})
      .filter(([label]) => label !== 'Item Bonus')
      .reduce((sum, [, value]) => sum + Number(value ?? 0), 0);

    if (SKILLS.includes(key)) {
      if (item) bonuses[key] = { ...(bonuses[key] ?? {}), itemBonus: item };
      if (other) bonuses[key] = { ...(bonuses[key] ?? {}), other };
    } else if (item || other) {
      unmapped.push(name);
    }
  }

  if (unmapped.length) {
    warnings.push(
      `Pathbuilder has bonuses on ${unmapped.join(', ')}, which the sheet has no field for. `
      + 'Add them by hand.',
    );
  }
  return bonuses;
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
