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
