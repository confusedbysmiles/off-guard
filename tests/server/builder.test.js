/**
 * The builder, end to end through the API.
 *
 * The point of these tests is the last one: a character built here has to look
 * to the GM exactly like one typed in by hand. That is the whole integration
 * claim, and it is checked by reading the party panel rather than by reading
 * the sheet the builder just wrote.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { freshDb, seed } from './helpers.js';
import { stubOptions } from './stub-options.js';

let app; let db; let world;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({ db, builderOptions: stubOptions(), logger: false });
  await app.ready();
});

afterEach(async () => { await app.close(); });

const player = (path, options = {}) => app.inject({
  url: `/api/c/${world.tuesday.characterToken}${path}`, ...options,
});

const gm = (path) => app.inject({ url: `/api/gm/${world.gmToken}${path}` });

/** A dwarf acolyte fighter, complete at level 1. */
const FIGHTER = {
  version: 1,
  level: 1,
  name: 'Durgan',
  ancestry: 'ancestry:dwarf',
  heritage: 'heritage:rock-dwarf',
  background: 'background:acolyte',
  class: 'class:fighter',
  attributes: {
    ancestry: ['str'], background: ['wis', 'str'], class: 'str',
    1: ['str', 'dex', 'con', 'cha'],
  },
  skills: { trained: ['athletics', 'intimidation', 'survival'], increases: {}, lores: [] },
  feats: {},
};

describe('the builder API', () => {
  it('starts a character that has never been built with an empty build', async () => {
    const res = await player('/builder');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.build.level).toBe(1);
    expect(body.build.class).toBe(null);
    expect(body.outstanding).toBeGreaterThan(0);
  });

  it('searches the catalogue with a slot’s own filter', async () => {
    const res = await player('/builder/options?kind=heritage&ancestry=ancestry:dwarf');
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r) => r.name)).toContain('Rock Dwarf');
  });

  /**
   * The question a builder asks about a weapon is "which of these may I use",
   * and the answer is a set of categories rather than one. A wizard is trained
   * in unarmed and simple attacks, which is 338 of the catalogue's 1,013
   * weapons -- the difference between a list and a search box.
   */
  it('narrows equipment to several categories at once', async () => {
    const all = await player('/builder/options?kind=equipment&itemType=weapon');
    const simple = await player('/builder/options?kind=equipment&itemType=weapon&categories=simple');
    const names = (res) => res.json().rows.map((row) => row.name);

    expect(names(all)).toEqual(expect.arrayContaining(['Longsword', 'Dagger']));
    // The longsword is martial and the dagger is simple.
    expect(names(simple)).toContain('Dagger');
    expect(names(simple)).not.toContain('Longsword');

    const both = await player('/builder/options?kind=equipment&itemType=weapon&categories=simple,martial');
    expect(names(both)).toEqual(expect.arrayContaining(['Longsword', 'Dagger']));
  });

  it('narrows by nothing when the list of categories is empty', async () => {
    // What an unclassed character sends: "untrained in everything" is not what
    // an empty slot means, so an empty list must not filter to nothing.
    const res = await player('/builder/options?kind=equipment&itemType=weapon&categories=');
    expect(res.json().rows.map((r) => r.name)).toContain('Longsword');
  });

/**
 * A background that is in no book, through the API the browser uses.
 *
 * The rules-level tests cover what it derives; this covers the part that would
 * break first -- `resolveBuild` handing the derivation a string where it now
 * sometimes gets an object, and the timeline having nothing to call a slot
 * whose answer has no id.
 */
describe('a background somebody wrote', () => {
  const CARAVAN = {
    name: 'Caravan guard',
    boosts: ['str', 'con'],
    skill: 'athletics',
    lore: 'Caravan Lore',
    feat: 'Hefty Hauler',
  };

  const save = (background) => player('/builder', {
    method: 'PATCH',
    payload: { build: { ...FIGHTER, background, attributes: { ...FIGHTER.attributes, background: ['str'] } } },
  });

  it('trains its skill, carries its Lore, and names itself', async () => {
    const res = await save({ custom: CARAVAN });
    expect(res.statusCode).toBe(200);
    const { builder } = res.json();

    expect(builder.sheet.background).toBe('Caravan guard');
    expect(builder.sheet.skills.athletics.rank).toBe('trained');
    expect(builder.sheet.lores).toContainEqual({ name: 'Caravan Lore', rank: 'trained' });
  });

  it('is not reported missing, having named nothing to miss', async () => {
    const { builder } = (await save({ custom: CARAVAN })).json();
    expect(builder.missing).toEqual([]);
    const slot = builder.slots.find((s) => s.kind === 'background');
    expect(slot).toMatchObject({ filledName: 'Caravan guard', filledCustom: true, empty: false });
  });

  it('offers the boosts it narrowed, and one free', async () => {
    const { builder } = (await save({ custom: CARAVAN })).json();
    const boosts = builder.slots.find((s) => s.id === 'background-boosts');
    expect(boosts.options[0]).toEqual(['str', 'con']);
    expect(boosts.options[1]).toHaveLength(6);
  });

  it('survives the round trip, so reopening the page shows what was typed', async () => {
    await save({ custom: CARAVAN });
    const { build } = (await player('/builder')).json();
    expect(build.background).toEqual({ custom: CARAVAN });
  });

  it('still takes a catalogue id, which is what most builds hold', async () => {
    const { builder } = (await save('background:acolyte')).json();
    expect(builder.sheet.background).toBe('Acolyte');
    expect(builder.slots.find((s) => s.kind === 'background').filledCustom).toBeUndefined();
  });
});

  it('returns one option in full', async () => {
    const res = await player('/builder/options/class:fighter');
    expect(res.json().option.name).toBe('Fighter');
    expect((await player('/builder/options/class:nonesuch')).statusCode).toBe(404);
  });

  it('refuses a body that is not a build', async () => {
    const res = await player('/builder', {
      method: 'PATCH', payload: { build: 'a fighter, please' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('derives the sheet when a build is saved', async () => {
    const res = await player('/builder', { method: 'PATCH', payload: { build: FIGHTER } });
    expect(res.statusCode).toBe(200);

    const sheet = res.json().character.sheet;
    expect(sheet.name).toBe('Durgan');
    expect(sheet.class).toBe('Fighter');
    expect(sheet.abilities).toMatchObject({ str: 4, con: 2 });
    expect(sheet.perception.rank).toBe('expert');
    expect(sheet.hp.max).toBe(22);
    // The build itself is kept, so the choices can be edited later.
    expect(sheet.build.class).toBe('class:fighter');
  });

  it('writes nothing for a save that changes nothing', async () => {
    await player('/builder', { method: 'PATCH', payload: { build: FIGHTER } });
    const again = await player('/builder', { method: 'PATCH', payload: { build: FIGHTER } });
    // Only the build document itself, which is always written.
    expect(again.json().applied.map((a) => a.path)).toEqual(['build']);
  });

  it('leaves play state alone when a character is rebuilt', async () => {
    await player('/builder', { method: 'PATCH', payload: { build: FIGHTER } });
    await player('/', {
      method: 'PATCH',
      payload: { writes: [
        { path: 'hp.current', value: 4 },
        { path: 'conditions', value: ['frightened'] },
        { path: 'heroPoints', value: 2 },
      ] },
    });

    // Level up, which changes hit points and much else.
    await player('/builder', { method: 'PATCH', payload: { build: { ...FIGHTER, level: 3 } } });

    const sheet = (await player('/')).json().character.sheet;
    expect(sheet.level).toBe(3);
    expect(sheet.hp.max).toBe(46);
    // None of which healed anyone.
    expect(sheet.hp.current).toBe(4);
    expect(sheet.conditions).toEqual(['frightened']);
    expect(sheet.heroPoints).toBe(2);
  });

  it('keeps the free-text sections the builder does not own', async () => {
    await player('/', {
      method: 'PATCH',
      payload: { writes: [{ path: 'notes', value: 'Owes the dwarf a favour.' }] },
    });
    await player('/builder', { method: 'PATCH', payload: { build: FIGHTER } });
    expect((await player('/')).json().character.sheet.notes).toBe('Owes the dwarf a favour.');
  });

  it('plans a level without changing anything today', async () => {
    const planned = {
      ...FIGHTER,
      planTo: 5,
      attributes: { ...FIGHTER.attributes, 5: ['str', 'dex', 'con', 'wis'] },
      feats: { 'classFeat-2': 'feat:power-attack' },
    };
    const res = await player('/builder', { method: 'PATCH', payload: { build: planned } });
    const body = res.json();

    expect(body.character.sheet.abilities.dex).toBe(1);
    expect(body.character.sheet.level).toBe(1);
    // The plan is stored and the timeline shows it.
    expect(body.builder.slots.some((s) => s.id === 'classFeat-2' && s.planned)).toBe(true);
    expect(body.character.sheet.build.attributes[5]).toEqual(['str', 'dex', 'con', 'wis']);
  });

  it('reports what is still unchosen instead of filling it in', async () => {
    const half = { ...FIGHTER, skills: { trained: [], increases: {}, lores: [] } };
    const body = (await player('/builder', { method: 'PATCH', payload: { build: half } })).json();
    expect(body.builder.problems.some((p) => p.section === 'skills')).toBe(true);
    expect(body.builder.outstanding).toBeGreaterThan(0);
  });

  it('says so when a build names an option the catalogue does not have', async () => {
    const stale = { ...FIGHTER, class: 'class:cavalier' };
    const body = (await player('/builder', { method: 'PATCH', payload: { build: stale } })).json();
    expect(body.builder.missing).toContainEqual(
      expect.objectContaining({ field: 'class', id: 'class:cavalier' }),
    );
  });

  /**
   * The integration claim, checked from the other side of the application.
   */
  it('appears to the GM as an ordinary character', async () => {
    await player('/builder', { method: 'PATCH', payload: { build: { ...FIGHTER, level: 5 } } });

    const party = (await gm(`/campaigns/${world.tuesday.campaign.id}/party`)).json();
    const durgan = party.characters.find((c) => c.name === 'Durgan');

    expect(durgan).toBeTruthy();
    expect(durgan.class).toBe('Fighter');
    expect(durgan.level).toBe(5);
    // Computed by the GM's own party code from the derived sheet, not copied
    // from anything the builder wrote: expert perception at level 5 with +2 Wis.
    expect(durgan.perception).toBe(11);
    expect(durgan.saves.fortitude).toBe(11);
    expect(durgan.hp.max).toBe(70);
    // And it is not flagged as an empty or stale sheet.
    expect(durgan.flags.map((f) => f.kind)).not.toContain('empty');
  });
});
