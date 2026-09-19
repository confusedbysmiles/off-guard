/**
 * Options a table wrote for itself.
 *
 * Two things are being pinned here. The first is that a homebrew option is
 * indistinguishable from a catalogue one everywhere downstream -- it is picked
 * the same way, it derives the same numbers, and a build stores an id either
 * way. The second is that it belongs to one campaign and reaches no other, and
 * that this holds through the picker as well as through the API.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const get = (url) => app.inject({ method: 'GET', url });
const post = (url, payload) => app.inject({ method: 'POST', url, payload });
const patch = (url, payload) => app.inject({ method: 'PATCH', url, payload });
const del = (url) => app.inject({ method: 'DELETE', url });

const gm = (path) => `/api/gm/${world.gmToken}${path}`;
const tuesdayId = () => world.tuesday.campaign.id;
const saturdayId = () => world.saturday.campaign.id;

/** The Tuesday player's builder. */
const builder = (path = '') => `/api/c/${world.tuesday.characterToken}/builder${path}`;
const otherBuilder = (path = '') => `/api/c/${world.saturday.characterToken}/builder${path}`;

const CARAVAN_GUARD = {
  kind: 'background',
  name: 'Caravan guard',
  boosts: ['str', 'con'],
  skill: 'athletics',
  lore: 'Caravan Lore',
  feat: 'Hefty Hauler',
  description: 'You walked beside the wagons.',
};

async function create(fields, campaignId = tuesdayId()) {
  const res = await post(gm(`/campaigns/${campaignId}/homebrew`), fields);
  expect(res.statusCode).toBe(201);
  return res.json().homebrew;
}

/** Save a build through the player's own route, the way the browser does. */
async function saveBuild(build, url = builder()) {
  const res = await patch(url, { build });
  expect(res.statusCode).toBe(200);
  return res.json().builder;
}

describe('a background the GM wrote', () => {
  it('is offered in that campaign’s picker', async () => {
    const entry = await create(CARAVAN_GUARD);
    const rows = (await get(builder(`/options?kind=background&q=caravan`))).json().rows;
    expect(rows.map((row) => row.name)).toContain('Caravan guard');
    expect(rows.find((row) => row.name === 'Caravan guard').id).toBe(entry.id);
  });

  it('is badged, so a player can see it did not come from a book', async () => {
    await create(CARAVAN_GUARD);
    const row = (await get(builder('/options?kind=background&q=caravan'))).json()
      .rows.find((r) => r.name === 'Caravan guard');
    expect(row.homebrew).toBe(true);
    expect(row.book).toBe('This table');
  });

  it('is not offered to another campaign', async () => {
    await create(CARAVAN_GUARD);
    const rows = (await get(otherBuilder('/options?kind=background&q=caravan'))).json().rows;
    expect(rows).toEqual([]);
  });

  it('cannot be read by another campaign’s player even with the id', async () => {
    const entry = await create(CARAVAN_GUARD);
    const res = await get(otherBuilder(`/options/${encodeURIComponent(entry.id)}`));
    expect(res.statusCode).toBe(404);
  });

  it('derives exactly as a printed background does', async () => {
    const entry = await create(CARAVAN_GUARD);
    const state = await saveBuild({
      ...(await get(builder())).json().build,
      background: entry.id,
      attributes: { ancestry: [], background: ['str', 'dex'], class: null },
    });

    expect(state.sheet.background).toBe('Caravan guard');
    expect(state.sheet.skills.athletics.rank).toBe('trained');
    expect(state.sheet.lores).toEqual([{ name: 'Caravan Lore', rank: 'trained' }]);
    expect(state.missing).toEqual([]);
  });

  it('offers the narrowed boost and one free, like a printed one', async () => {
    const entry = await create(CARAVAN_GUARD);
    const state = await saveBuild({ ...(await get(builder())).json().build, background: entry.id });
    const slot = state.slots.find((s) => s.id === 'background-boosts');
    expect(slot.options).toEqual([['str', 'con'], ['str', 'dex', 'con', 'int', 'wis', 'cha']]);
  });

  it('still shows the whole catalogue beside it', async () => {
    await create(CARAVAN_GUARD);
    const body = (await get(builder('/options?kind=background&limit=5'))).json();
    expect(body.total).toBe(515);
  });
});

describe('an ancestry the GM wrote', () => {
  const ASHEN = {
    kind: 'ancestry',
    name: 'Ashen-Blooded',
    hp: 10, speed: 30, size: 'sm',
    boosts: ['con'], freeBoosts: 1, flaws: ['cha'],
    languages: ['common', 'cinder-cant'],
    vision: 'darkvision',
    traits: ['ashen', 'humanoid'],
  };

  it('reaches the sheet: hit points, speed, size and languages', async () => {
    const entry = await create(ASHEN);
    const state = await saveBuild({
      ...(await get(builder())).json().build,
      ancestry: entry.id,
      class: 'class:fighter',
      attributes: { ancestry: ['str'], background: [], class: 'str' },
    });

    expect(state.sheet.ancestry).toBe('Ashen-Blooded');
    expect(state.sheet.size).toBe('Small');
    expect(state.sheet.speed).toBe(30);
    expect(state.sheet.languages).toContain('cinder-cant');
    expect(state.missing).toEqual([]);
  });

  it('grants its fixed boost and takes its flaw', async () => {
    const entry = await create(ASHEN);
    const state = await saveBuild({
      ...(await get(builder())).json().build,
      ancestry: entry.id,
      attributes: { ancestry: ['str'], background: [], class: null },
    });
    // 10 + 2 for the granted Constitution, 10 - 2 for the Charisma flaw.
    expect(state.sheet.abilities.con).toBe(1);
    expect(state.sheet.abilities.cha).toBe(-1);
    expect(state.sheet.abilities.str).toBe(1);
  });

  it('asks for the free boost it grants, and no more', async () => {
    const entry = await create(ASHEN);
    const state = await saveBuild({ ...(await get(builder())).json().build, ancestry: entry.id });
    const slot = state.slots.find((s) => s.id === 'ancestry-boosts');
    expect(slot.count).toBe(1);
  });
});

describe('a heritage the GM wrote', () => {
  it('is offered under the ancestry it belongs to', async () => {
    const entry = await create({
      kind: 'heritage', name: 'Cinderborn', ancestry: 'ancestry:dwarf',
      description: 'Born in the ash.',
    });
    const rows = (await get(builder('/options?kind=heritage&ancestry=ancestry:dwarf&q=cinder')))
      .json().rows;
    expect(rows.map((r) => r.id)).toContain(entry.id);
  });

  it('is not offered under a different ancestry', async () => {
    await create({ kind: 'heritage', name: 'Cinderborn', ancestry: 'ancestry:dwarf' });
    const rows = (await get(builder('/options?kind=heritage&ancestry=ancestry:elf&q=cinder')))
      .json().rows;
    expect(rows).toEqual([]);
  });

  it('is offered to everyone when it names no ancestry, like a versatile heritage', async () => {
    await create({ kind: 'heritage', name: 'Wanderborn' });
    const rows = (await get(builder('/options?kind=heritage&ancestry=ancestry:elf&q=wanderborn')))
      .json().rows;
    expect(rows.map((r) => r.name)).toEqual(['Wanderborn']);
  });

  it('puts its name on the sheet', async () => {
    const entry = await create({ kind: 'heritage', name: 'Cinderborn', ancestry: 'ancestry:dwarf' });
    const state = await saveBuild({
      ...(await get(builder())).json().build,
      ancestry: 'ancestry:dwarf', heritage: entry.id,
    });
    expect(state.sheet.heritage).toBe('Cinderborn');
  });
});

describe('a class the GM wrote', () => {
  const WARDEN = {
    kind: 'class',
    name: 'Warden',
    basedOn: 'class:fighter',
    hp: 8,
    keyAttributes: ['wis'],
    additionalSkills: 4,
    fixedSkills: ['nature'],
  };

  it('advances like the class it was based on', async () => {
    const entry = await create(WARDEN);
    const state = await saveBuild({
      ...(await get(builder())).json().build,
      level: 7, class: entry.id,
      attributes: { ancestry: [], background: [], class: 'wis' },
    });

    expect(state.sheet.class).toBe('Warden');
    // A fighter is master in Perception at 7 and expert in Will at 3.
    expect(state.sheet.perception.rank).toBe('master');
    expect(state.sheet.saves.will.rank).toBe('expert');
  });

  it('takes its own hit points, not the base class’s', async () => {
    const entry = await create(WARDEN);
    const level1 = await saveBuild({
      ...(await get(builder())).json().build,
      level: 1, class: entry.id,
      attributes: { ancestry: [], background: [], class: 'wis' },
    });
    // 8 per level from the class, and no ancestry chosen, and Constitution 0.
    expect(level1.sheet.hp.max).toBe(8);
  });

  it('trains the skills it names', async () => {
    const entry = await create(WARDEN);
    const state = await saveBuild({
      ...(await get(builder())).json().build, class: entry.id,
    });
    expect(state.sheet.skills.nature.rank).toBe('trained');
  });

  it('keeps the advancement it was saved with when the base class is not named', async () => {
    const entry = await create({ ...WARDEN, basedOn: null });
    const state = await saveBuild({
      ...(await get(builder())).json().build, level: 7, class: entry.id,
    });
    // No table to copy, so nothing advances -- visible rather than silently wrong.
    expect(state.sheet.perception.rank).toBe('trained');
    expect(state.missing).toEqual([]);
  });
});

describe('what a form is not allowed to say', () => {
  it('drops an attribute that is not one', async () => {
    const entry = await create({
      ...CARAVAN_GUARD, boosts: ['strength', 'con'],
    });
    expect(entry.record.boosts[0].options).toEqual(['con']);
  });

  it('drops a skill that is not one', async () => {
    const entry = await create({ ...CARAVAN_GUARD, skill: 'lockpicking' });
    expect(entry.record.trainedSkills).toEqual([]);
  });

  it('falls back to Medium for a size that is not one', async () => {
    const entry = await create({ kind: 'ancestry', name: 'Thing', size: 'enormous' });
    expect(entry.record.size).toBe('med');
    expect(entry.record.sizeName).toBe('Medium');
  });

  it('escapes the description rather than trusting it', async () => {
    const entry = await create({
      ...CARAVAN_GUARD,
      description: 'Careful: <img src=x onerror="alert(1)"> & co.',
    });
    expect(entry.record.description.html).not.toContain('<img');
    expect(entry.record.description.html).toContain('&lt;img');
    expect(entry.record.description.html).toContain('&amp; co.');
  });

  it('refuses a nameless option', async () => {
    const res = await post(gm(`/campaigns/${tuesdayId()}/homebrew`), {
      kind: 'background', name: '   ',
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a kind that is not one of the four', async () => {
    const res = await post(gm(`/campaigns/${tuesdayId()}/homebrew`), {
      kind: 'feat', name: 'Power Attack',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('managing them', () => {
  it('replaces the record rather than merging into it', async () => {
    const entry = await create(CARAVAN_GUARD);
    const res = await patch(gm(`/campaigns/${tuesdayId()}/homebrew/${entry.rowId}`), {
      name: 'Caravan guard', skill: 'survival', boosts: ['str'],
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().homebrew;
    expect(updated.record.trainedSkills).toEqual(['survival']);
    // The Lore was cleared in the form, so it is cleared on the record.
    expect(updated.record.trainedLore).toEqual([]);
  });

  it('keeps its id across a rename, so a build does not lose it', async () => {
    const entry = await create(CARAVAN_GUARD);
    await saveBuild({ ...(await get(builder())).json().build, background: entry.id });

    await patch(gm(`/campaigns/${tuesdayId()}/homebrew/${entry.rowId}`), {
      ...CARAVAN_GUARD, name: 'Caravan outrider',
    });

    const state = (await get(builder())).json();
    expect(state.sheet.background).toBe('Caravan outrider');
    expect(state.missing).toEqual([]);
  });

  it('says how many characters have chosen it', async () => {
    const entry = await create(CARAVAN_GUARD);
    await saveBuild({ ...(await get(builder())).json().build, background: entry.id });

    const listed = (await get(gm(`/campaigns/${tuesdayId()}/homebrew`))).json().homebrew;
    expect(listed[0].usedBy).toBe(1);
  });

  it('leaves a build that named a deleted option as a visible gap, not an error', async () => {
    const entry = await create(CARAVAN_GUARD);
    await saveBuild({ ...(await get(builder())).json().build, background: entry.id });

    expect((await del(gm(`/campaigns/${tuesdayId()}/homebrew/${entry.rowId}`))).statusCode).toBe(200);

    const res = await get(builder());
    expect(res.statusCode).toBe(200);
    expect(res.json().missing).toEqual([
      expect.objectContaining({ field: 'background', id: entry.id }),
    ]);
  });
});

describe('who may touch them', () => {
  it('is not the player', async () => {
    const res = await post(
      `/api/gm/${world.tuesday.characterToken}/campaigns/${tuesdayId()}/homebrew`,
      CARAVAN_GUARD,
    );
    expect(res.statusCode).toBe(404);
  });

  it('is not the shared screen', async () => {
    const res = await post(
      `/api/gm/${world.tuesday.tableToken}/campaigns/${tuesdayId()}/homebrew`,
      CARAVAN_GUARD,
    );
    expect(res.statusCode).toBe(404);
  });

  it('is the GM, in the campaign they named', async () => {
    await create(CARAVAN_GUARD, saturdayId());
    const tuesday = (await get(gm(`/campaigns/${tuesdayId()}/homebrew`))).json().homebrew;
    const saturday = (await get(gm(`/campaigns/${saturdayId()}/homebrew`))).json().homebrew;
    expect(tuesday).toEqual([]);
    expect(saturday).toHaveLength(1);
  });

  it('cannot be deleted from the wrong campaign', async () => {
    const entry = await create(CARAVAN_GUARD, saturdayId());
    const res = await del(gm(`/campaigns/${tuesdayId()}/homebrew/${entry.rowId}`));
    expect(res.statusCode).toBe(404);
  });
});
