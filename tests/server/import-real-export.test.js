/**
 * A real Pathbuilder export, end to end.
 *
 * The other fixtures in `tests/fixtures/pathbuilder` are hand-written stubs of
 * about 1.7 KB. They pass, and they passed through an import bug reported from
 * an actual table -- because they do not contain the shapes Pathbuilder really
 * emits: equipment rows carrying a container UUID as a fourth field, feats in
 * the seven-field form, lores, weapon `runes`/`grade`/`extraDamage`, a numeric
 * `size` beside `sizeName`, and empty `spellCasters`/`pets`/`familiars` arrays.
 *
 * `barbarian-5-automaton.json` is a file exported from Pathbuilder by hand and
 * committed unedited. Nothing here asserts a hand-written expectation about its
 * contents: the point is that the whole path survives the real shape.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { freshApp } from './helpers.js';

const EXPORT = JSON.parse(readFileSync(
  new URL('../fixtures/pathbuilder/barbarian-5-automaton.json', import.meta.url), 'utf8',
));

let app; let db; let world;
beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const post = (path, payload) => app.inject({
  method: 'POST', url: `/api/c/${world.tuesday.characterToken}${path}`, payload,
});

/** Import the file the way the dialog does, and read the sheet that results. */
async function applied() {
  const preview = (await post('/import/preview', { json: EXPORT })).json();
  await post('/import/apply', {
    sheet: preview.sheet, changes: preview.changes, build: preview.builder.build,
  });
  const res = await app.inject({
    method: 'GET', url: `/api/c/${world.tuesday.characterToken}`,
  });
  return res.json().character.sheet;
}

describe('previewing it', () => {
  it('is accepted, and reads the character out of it', async () => {
    const res = await post('/import/preview', { json: EXPORT });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sheet.name).toBe('Gir Whir Clank');
    expect(body.sheet.class).toBe('Barbarian');
    expect(body.sheet.level).toBe(5);
    expect(body.changes.length).toBeGreaterThan(20);
  });

  it('warns about Bulk rather than inventing it', async () => {
    // Pathbuilder does not export Bulk. Saying so is the honest answer; a
    // guessed number would be worse than none.
    const { warnings } = (await post('/import/preview', { json: EXPORT })).json();
    expect(warnings.join(' ')).toMatch(/Bulk/);
  });

  it('puts the chosen feats in the slots they belong to', async () => {
    // Pathbuilder names the slot itself -- "Barbarian Feat 1", "Skill Feat 2" --
    // and the builder keys its choices by `<kind>-<level>`, so this is a
    // translation rather than a guess.
    const { builder } = (await post('/import/preview', { json: EXPORT })).json();
    expect(builder.build.feats).toMatchObject({
      'classFeat-1': 'feat:sudden-charge',
      'classFeat-2': 'feat:raging-intimidation',
      'classFeat-4': 'feat:intimidating-strike',
      'skillFeat-2': 'feat:titan-wrestler',
      'skillFeat-4': 'feat:group-coercion',
      'generalFeat-3': 'feat:fleet',
      'ancestryFeat-1': 'feat:reinforced-chassis',
      'ancestryFeat-5': 'feat:powerful-tail',
    });
  });

  it('does not spend a choice on a feat nobody chose', async () => {
    // Quick Repair, Toughness and Intimidating Glare are awarded by the
    // background and ancestry -- four fields and no slot name. Filling a slot
    // with one would cost the character a choice they still have.
    const { builder } = (await post('/import/preview', { json: EXPORT })).json();
    const ids = Object.values(builder.build.feats);
    expect(ids).not.toContain('feat:toughness');
    expect(ids).not.toContain('feat:quick-repair');
    // And the heritage is a field of its own, not a feat slot.
    expect(ids.join(' ')).not.toMatch(/defensive-automaton/);
  });

  it('derives the features a character is given rather than choosing', async () => {
    // Seven of the file's ten specials used to vanish. They are not imported
    // even now -- they are derived from the class, ancestry and heritage the
    // import established, which is also right for a character built here. So
    // this asserts the sheet that results, not the mapper's half of it.
    const names = (await applied()).features.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining([
      'Rage', 'Quick-Tempered', 'Furious Footfalls', 'Brutality',
      'Automaton Core', 'Constructed Body', 'Low-Light Vision',
    ]));
  });

  it('holds a grant above the character\u2019s level until they reach it', async () => {
    // Brutality is a level 5 grant and this barbarian is level 5, so it counts.
    // Juggernaut is level 7 and does not.
    const features = (await applied()).features;
    expect(features.find((f) => f.name === 'Brutality')).toMatchObject({ level: 5 });
    expect(features.map((f) => f.name)).not.toContain('Juggernaut');
  });

  it('lists only the instinct that was chosen, not the nine on offer', async () => {
    // The trap this avoids: reading the feature catalogue by trait sweeps in
    // every option a class offers. A barbarian picks one instinct of nine.
    const sheet = await applied();
    const names = sheet.features.map((f) => f.name);
    for (const other of ['Animal Instinct', 'Giant Instinct', 'Fury Instinct', 'Spirit Instinct']) {
      expect(names).not.toContain(other);
    }
    // The one they took is the subclass, and already shown as such.
    expect(sheet.subclass).toBe('Dragon Instinct');
  });

  it('remembers what is packed inside what', async () => {
    // The applied sheet, not the preview. The mapper always carried containers;
    // what dropped them was the build's own gear list overwriting it, and a
    // test against the preview passes either way.
    const sheet = await applied();
    const inBag = sheet.gear.filter((g) => g.container === 'Backpack').map((g) => g.name);
    expect(inBag).toEqual(expect.arrayContaining(['Bedroll', 'Chalk', 'Rope', 'Waterskin']));
    // The backpack is not inside itself, and loose items stay loose.
    expect(sheet.gear.find((g) => g.name === 'Backpack').container).toBeNull();
    expect(sheet.gear.find((g) => g.name === 'Arrows').container).toBeNull();
  });

  it('does not import Pathbuilder\u2019s placeholder as a language', async () => {
    // The export says ["None selected"] when nobody picked any, and that went
    // onto the sheet verbatim -- a character who spoke "None selected".
    const { sheet } = (await post('/import/preview', { json: EXPORT })).json();
    expect(sheet.languages).toEqual([]);
  });

  it('hands back a builder block the dialog can render', async () => {
    // The dialog reads `summary.outstanding` without guarding it, so a builder
    // block without a summary is a TypeError in the browser and an import that
    // "just errors" at the table.
    const { builder } = (await post('/import/preview', { json: EXPORT })).json();
    expect(builder).toBeTruthy();
    expect(builder.summary).toBeTruthy();
    expect(builder.summary.outstanding).toBeTypeOf('number');
    expect(builder.build).toBeTruthy();
  });

  it('keeps the money and the container the bag is in', async () => {
    // Both were dropped in silence once. Eight of this file's twelve equipment
    // rows carry a container UUID as a fourth field, which the stubs have none of.
    const { sheet } = (await post('/import/preview', { json: EXPORT })).json();
    expect(JSON.stringify(sheet)).toMatch(/Backpack/);
    expect(sheet.money ?? sheet.coins ?? null).not.toBeNull();
  });
});

describe('applying it', () => {
  it('saves, and the sheet comes back as the imported character', async () => {
    const preview = (await post('/import/preview', { json: EXPORT })).json();
    const applied = await post('/import/apply', {
      sheet: preview.sheet, changes: preview.changes,
    });
    expect(applied.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET', url: `/api/c/${world.tuesday.characterToken}`,
    });
    expect(after.json().character.sheet.name).toBe('Gir Whir Clank');
  });
});

/**
 * Two numbers a player at the table checked against Pathbuilder by hand, and
 * found wrong. Both were the same bug twice: the import wrote a value, and the
 * build document derived over the top of it with something it had never been
 * given. Asserting on the preview would have missed both -- the preview was
 * right. These read the saved sheet.
 */
describe('the numbers the player checks', () => {
  const byName = (strikes, name) => strikes.find((s) => s.name.includes(name));

  it('attacks with a bow using Dexterity, not Strength', async () => {
    // Gir's Strength is two points above his Dexterity, so a bow built
    // without a range reads as a melee weapon and comes out exactly two
    // points high: +13 where Pathbuilder says +11.
    const sheet = await applied();
    expect(byName(sheet.strikes, 'Composite Longbow').mod).toBe(11);
    expect(byName(sheet.strikes, 'Javelin').mod).toBe(11);
  });

  it('still adds Strength for the melee weapon', async () => {
    // The other half of the same fix: ranged must not become the new default.
    const sheet = await applied();
    expect(byName(sheet.strikes, 'War Flail').mod).toBe(14);
  });

  it('matches Pathbuilder’s own to-hit for every weapon it exported', async () => {
    const sheet = await applied();
    for (const weapon of EXPORT.build.weapons) {
      const strike = sheet.strikes.find((s) => s.name.includes(weapon.name));
      expect(strike, weapon.name).toBeTruthy();
      expect(strike.mod, weapon.name).toBe(weapon.attack);
    }
  });

  it('adds the attribute to damage once, not twice', async () => {
    // Pathbuilder's `damageBonus` is the whole flat bonus; the build's field is
    // only what sits on top of the attribute. Copying one into the other made
    // the flail 2d10+8 against Pathbuilder's 2d10+4.
    const sheet = await applied();
    expect(byName(sheet.strikes, 'War Flail').damage).toBe('2d10+4');
  });

  it('gives a propulsive bow half Strength and a thrown javelin all of it', async () => {
    const sheet = await applied();
    expect(byName(sheet.strikes, 'Composite Longbow').damage).toBe('1d8+2');
    expect(byName(sheet.strikes, 'Javelin').damage).toBe('1d6+4');
  });

  it('matches Pathbuilder’s own flat damage for every weapon it exported', async () => {
    const sheet = await applied();
    for (const weapon of EXPORT.build.weapons) {
      const strike = sheet.strikes.find((s) => s.name.includes(weapon.name));
      expect(strike.components.damageFlat, weapon.name).toBe(weapon.damageBonus);
    }
  });

  it('counts the bonus hit points from Toughness and the heritage', async () => {
    // bonushpPerLevel 1 x level 5, plus a flat bonushp 2: the seven points
    // the sheet was short. Neither feature alone accounts for seven.
    const sheet = await applied();
    const { ancestryhp, classhp, bonushp, bonushpPerLevel } = EXPORT.build.attributes;
    const conMod = Math.floor((EXPORT.build.abilities.con - 10) / 2);
    const level = EXPORT.build.level;
    expect(sheet.hp.max).toBe(
      ancestryhp + (classhp + conMod) * level + bonushpPerLevel * level + bonushp,
    );
    expect(sheet.hp.max).toBe(90);
  });
});
