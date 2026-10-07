/**
 * Filling one slot, checked.
 *
 * `PATCH /builder` trusts the document it is given, which is right for a page
 * whose picker only offers legal choices. This endpoint exists for a caller
 * that is not a picker, and every test here is about what it refuses -- a
 * model will choose a feat this character cannot take, confidently, and the
 * slot filters were advisory until something enforced them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const token = () => world.tuesday.characterToken;

const choose = (slotId, value) => app.inject({
  method: 'POST', url: `/api/c/${token()}/builder/choose`, payload: { slotId, value },
});

const builder = async () => (await app.inject({
  method: 'GET', url: `/api/c/${token()}/builder`,
})).json();

/** The level is a property of the build rather than a slot, so it is set the
 * way the builder page sets it. */
const setLevel = async (level) => {
  const state = await builder();
  return app.inject({
    method: 'PATCH', url: `/api/c/${token()}/builder`,
    payload: { build: { ...state.build, level } },
  });
};

/** A dwarf fighter at a level where the interesting slots exist. */
const started = async (level = 4) => {
  await choose('ancestry', 'ancestry:dwarf');
  await choose('class', 'class:fighter');
  await setLevel(level);
};

describe('what it accepts', () => {
  it('fills an identity slot and derives from it immediately', async () => {
    const res = await choose('ancestry', 'ancestry:dwarf');
    expect(res.statusCode).toBe(200);
    expect(res.json().builder.sheet.ancestry).toBe('Dwarf');
    expect((await builder()).build.ancestry).toBe('ancestry:dwarf');
  });

  it('takes attribute boosts as a list', async () => {
    await started();
    const res = await choose('boosts-1', ['str', 'dex', 'con', 'wis']);
    expect(res.statusCode).toBe(200);
    expect(res.json().builder.sheet.abilities.str).toBeGreaterThan(0);
  });

  it('takes a skill increase, and a Lore by name', async () => {
    await started();
    expect((await choose('skillIncrease-3', 'athletics')).statusCode).toBe(200);
    expect((await choose('lores', ['Vault Lore'])).statusCode).toBe(200);
    const state = await builder();
    expect(state.build.skills.increases['3']).toBe('athletics');
    expect(state.sheet.lores).toContainEqual({ name: 'Vault Lore', rank: 'trained' });
  });

  it('clears a slot when given nothing', async () => {
    await choose('ancestry', 'ancestry:dwarf');
    expect((await choose('ancestry', null)).statusCode).toBe(200);
    expect((await builder()).build.ancestry).toBe(null);
  });

  /**
   * The rule that has to survive being lifted out of the browser: a heritage
   * belongs to one ancestry, and leaving it would put a dwarf heritage on an
   * elf.
   */
  it('drops a heritage that belonged to the ancestry being replaced', async () => {
    await choose('ancestry', 'ancestry:dwarf');
    await choose('heritage', 'heritage:strong-blooded-dwarf');
    expect((await builder()).build.heritage).toBe('heritage:strong-blooded-dwarf');

    await choose('ancestry', 'ancestry:elf');
    expect((await builder()).build.heritage).toBe(null);
  });
});

describe('what it refuses, and what it says', () => {
  it('a slot that does not exist, and lists the ones that do', async () => {
    const res = await choose('nonsense', 'ancestry:dwarf');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no slot called "nonsense"/);
    expect(res.json().slots.map((s) => s.id)).toContain('ancestry');
  });

  it('an id that is not in the catalogue at all', async () => {
    const res = await choose('ancestry', 'ancestry:nonesuch');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no option with the id/i);
  });

  /** The one this endpoint exists for. */
  it('a real option in the wrong slot', async () => {
    const res = await choose('ancestry', 'class:fighter');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Fighter is not something Ancestry offers/i);
    expect((await builder()).build.ancestry).toBe(null);
  });

  it('a feat the character has not reached the level for', async () => {
    await started();
    const state = await builder();
    const slot = state.slots.find((s) => s.kind === 'classFeat');
    expect(slot).toBeDefined();

    // A level 6 class feat offered to a level 1 slot.
    const tooHigh = (await app.inject({
      method: 'GET',
      url: `/api/c/${token()}/builder/options?kind=feat&category=class&trait=fighter&minLevel=6&limit=1`,
    })).json().rows[0];
    expect(tooHigh).toBeDefined();

    const res = await choose(slot.id, tooHigh.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/is not something .* offers/i);
  });

  it('an attribute that is not one', async () => {
    await started();
    const res = await choose('boosts-1', ['strength', 'dex']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/strength is not an attribute/i);
  });

  it('more boosts than the slot holds, and the same one twice', async () => {
    await started();
    expect((await choose('boosts-1', ['str', 'dex', 'con', 'wis', 'cha'])).json().error)
      .toMatch(/takes 4/);
    expect((await choose('boosts-1', ['str', 'str'])).json().error)
      .toMatch(/cannot take two/i);
  });

  it('a key attribute the class does not offer', async () => {
    await started();
    const res = await choose('key-attribute', 'cha');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/key attribute is one of/i);
  });

  it('a skill that is not one of the sixteen', async () => {
    await started();
    const res = await choose('trained-skills', ['lockpicking']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not one of the sixteen/i);
  });

  it('a heritage before there is an ancestry to hang it on', async () => {
    const res = await choose('heritage', 'heritage:strong-blooded-dwarf');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Choose ancestry first/i);
  });

  it('and writes nothing at all when it refuses', async () => {
    await started();
    const before = await builder();
    await choose('ancestry', 'class:fighter');
    await choose('boosts-1', ['strength']);
    await choose('nonsense', 'x');
    expect((await builder()).build).toEqual(before.build);
  });
});

describe('who may', () => {
  it('is not the shared screen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/c/${world.tuesday.tableToken}/builder/choose`,
      payload: { slotId: 'ancestry', value: 'ancestry:dwarf' },
    });
    expect(res.statusCode).toBe(404);
  });
});
