/**
 * Three more files Pathbuilder actually produced, for the parts one character
 * could not reach.
 *
 * `barbarian-5-automaton` has no spellcasting, no shield, no familiar and no
 * formulas, so it proved none of them. Each of these was exported by hand and
 * committed unedited:
 *
 *   sorcerer-2-spellcaster      two casters at once, one of them innate, and
 *                               a focus pool with a focus spell in it
 *   alchemist-1-shield-formulas a shield, resistances, a formula book
 *   ranger-8-familiar           a familiar, and feats in the parentChoice /
 *                               childChoice shape a versatile heritage makes
 *
 * Every assertion here is about something that was broken when the file
 * arrived. They are not a survey.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { freshApp } from './helpers.js';

const load = (name) => JSON.parse(readFileSync(
  new URL(`../fixtures/pathbuilder/${name}.json`, import.meta.url), 'utf8',
));

let app; let db; let world;
beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const token = () => world.tuesday.characterToken;
const preview = (json) => app
  .inject({ method: 'POST', url: `/api/c/${token()}/import/preview`, payload: { json } })
  .then((res) => res.json());

/** Import the way the dialog does, and read the sheet that results. */
async function applied(json) {
  const p = await preview(json);
  await app.inject({
    method: 'POST',
    url: `/api/c/${token()}/import/apply`,
    payload: { sheet: p.sheet, changes: p.changes, build: p.builder.build },
  });
  const res = await app.inject({ method: 'GET', url: `/api/c/${token()}` });
  return res.json().character.sheet;
}

describe('a sorcerer with two kinds of spellcasting', () => {
  const FILE = load('sorcerer-2-spellcaster');

  it('keeps both casters rather than the first', async () => {
    const sheet = await applied(FILE);
    expect(sheet.spellcasting).toHaveLength(2);
    expect(sheet.spellcasting.map((s) => s.name))
      .toEqual(expect.arrayContaining(['Sorcerer', 'Caster Arcane Sense']));
  });

  it('keeps the focus pool, which the build used to write back to zero', async () => {
    // `focus.pool` is a path the build owns, and the build knew nothing about
    // focus -- so the derivation overwrote the imported 1 with 0 and a
    // sorcerer arrived unable to cast their focus spell.
    expect((await applied(FILE)).focus.pool).toBe(1);
  });

  it('finds a feat the catalogue splits by caster kind', async () => {
    // Pathbuilder exports "Counterspell"; the catalogue prints "Counterspell
    // (Spontaneous)" and "Counterspell (Prepared)". The class trait says which.
    const { builder } = await preview(FILE);
    expect(builder.build.feats['classFeat-2']).toBe('feat:counterspell-spontaneous');
    expect(builder.notes).toEqual([]);
  });
});

describe('an alchemist with a shield and a formula book', () => {
  const FILE = load('alchemist-1-shield-formulas');

  it('imports the shield from the catalogue, not as a nameless custom one', async () => {
    // A shield's item type is `shield`, and the equipment lookup was hardcoded
    // to `armor` -- so this could never match and arrived worth +0 AC.
    const { shield } = await applied(FILE);
    expect(shield).toMatchObject({ name: 'Steel Shield', bonus: 2, hardness: 5, hp: 20 });
  });

  it('no longer claims the sheet has no shield field', async () => {
    const { warnings } = await preview(FILE);
    expect(warnings.join(' ')).not.toMatch(/no shield field/i);
  });

  it('says which formulas it could not take, rather than dropping them', async () => {
    const { warnings } = await preview(FILE);
    const about = warnings.find((w) => /formula/i.test(w));
    expect(about).toBeTruthy();
    expect(about).toMatch(/Acid Flask \(Lesser\)/);
  });

  it('keeps a resistance the ancestry grants', async () => {
    expect((await applied(FILE)).resistances).toEqual(['fire 1']);
  });
});

describe('a ranger with a familiar', () => {
  const FILE = load('ranger-8-familiar');

  it('says the familiar is not imported rather than losing it quietly', async () => {
    const { warnings } = await preview(FILE);
    expect(warnings.join(' ')).toMatch(/familiar/i);
  });

  it('still places the feats around it', async () => {
    const { builder } = await preview(FILE);
    expect(builder.build.feats).toMatchObject({
      'classFeat-1': 'feat:monster-hunter',
      'ancestryFeat-1': 'feat:devil-s-advocate',
    });
  });

  it('imports a character whose gear, weapons and armour are all empty', async () => {
    // Every list this file has is empty, which is its own shape of input.
    const sheet = await applied(FILE);
    expect(sheet.name).toBe('Unknown Adventurer');
    expect(sheet.gear).toEqual([]);
    expect(sheet.strikes).toEqual([]);
  });
});
