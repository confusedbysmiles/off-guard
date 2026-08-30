/**
 * What a reset keeps.
 *
 * The loop console's whole reason to exist is one rule -- the party remembers,
 * the world does not -- and it is the kind of rule that can be wrong for an
 * hour before anyone notices, because a wrong answer still looks like a
 * working console.
 */
import { describe, expect, it } from 'vitest';

import {
  blankState, fromRow, isPerfectRun, resetLoop, setInfluence, toRow,
} from '../../src/shared/loop.js';

const ADVENTURE = {
  id: 'test-loop',
  party: ['A', 'B', 'C'],
  faults: [{ id: 'wine' }, { id: 'guest' }, { id: 'aspic' }, { id: 'duke' }],
  influence: { max: 8 },
};

const solved = (state, id, extra = {}) => ({
  ...state,
  faults: { ...state.faults, [id]: { known: true, fixed: true, sticky: false, ...extra } },
});

describe('a blank run', () => {
  it('has every fault unknown and unfixed', () => {
    const state = blankState(ADVENTURE);
    expect(state.loop).toBe(1);
    expect(state.slot).toBe(1);
    expect(Object.keys(state.faults)).toEqual(['wine', 'guest', 'aspic', 'duke']);
    expect(Object.values(state.faults).every((f) => !f.known && !f.fixed)).toBe(true);
  });

  it('copies the party rather than aliasing it', () => {
    const state = blankState(ADVENTURE);
    state.party[0] = 'changed';
    expect(ADVENTURE.party[0]).toBe('A');
  });
});

describe('burning the room', () => {
  it('clears what was fixed but keeps what the party knows', () => {
    const before = solved(blankState(ADVENTURE), 'wine');
    const after = resetLoop(before);
    expect(after.faults.wine.fixed).toBe(false);
    expect(after.faults.wine.known).toBe(true);
  });

  it('advances the loop and returns to the first slot', () => {
    const after = resetLoop({ ...blankState(ADVENTURE), slot: 7 });
    expect(after.loop).toBe(2);
    expect(after.slot).toBe(1);
  });

  it('re-applies a fault solved permanently', () => {
    const before = solved(blankState(ADVENTURE), 'aspic', { sticky: true });
    const after = resetLoop(before);
    expect(after.faults.aspic.fixed).toBe(true);
    expect(after.faults.aspic.sticky).toBe(true);
  });

  it('resets influence points but not the high-water mark', () => {
    const before = setInfluence(blankState(ADVENTURE), 6, 8);
    const after = resetLoop(before);
    expect(after.influence.points).toBe(0);
    expect(after.influence.highWater).toBe(6);
  });

  it('keeps the slot log from earlier loops', () => {
    const before = { ...blankState(ADVENTURE), log: { 1: { 0: { 3: 'went to the cellar' } } } };
    expect(resetLoop(before).log[1][0][3]).toBe('went to the cellar');
  });

  it('does not mutate the state it was given', () => {
    const before = solved(blankState(ADVENTURE), 'wine');
    resetLoop(before);
    expect(before.faults.wine.fixed).toBe(true);
    expect(before.loop).toBe(1);
  });
});

describe('influence', () => {
  it('clamps to the adventure’s maximum and to zero', () => {
    expect(setInfluence(blankState(ADVENTURE), 99, 8).influence.points).toBe(8);
    expect(setInfluence(blankState(ADVENTURE), -3, 8).influence.points).toBe(0);
  });

  it('never lowers the high-water mark', () => {
    let state = setInfluence(blankState(ADVENTURE), 6, 8);
    state = setInfluence(state, 2, 8);
    expect(state.influence.points).toBe(2);
    expect(state.influence.highWater).toBe(6);
  });
});

describe('a perfect run', () => {
  it('needs every fault fixed at once', () => {
    let state = blankState(ADVENTURE);
    for (const id of ['wine', 'guest', 'aspic']) state = solved(state, id);
    expect(isPerfectRun(state, ADVENTURE)).toBe(false);
    state = solved(state, 'duke');
    expect(isPerfectRun(state, ADVENTURE)).toBe(true);
  });

  it('does not survive the reset that follows it', () => {
    let state = blankState(ADVENTURE);
    for (const id of ['wine', 'guest', 'aspic', 'duke']) state = solved(state, id);
    expect(isPerfectRun(resetLoop(state), ADVENTURE)).toBe(false);
  });

  it('is false for an adventure with no faults', () => {
    expect(isPerfectRun(blankState({ faults: [] }), { faults: [] })).toBe(false);
  });
});

describe('the database round trip', () => {
  it('returns the state it was given', () => {
    let state = solved(blankState(ADVENTURE), 'wine');
    state = setInfluence({ ...state, slot: 4, loop: 3 }, 6, 8);
    state.influence.discovered = ['Society'];
    state.log = { 3: { 1: { 2: 'talked to the Duke' } } };

    const row = toRow(state);
    const back = fromRow({ ...row, detail: JSON.stringify(row.detail) });

    expect(back).toEqual(state);
  });

  it('keeps the spine in columns rather than in the JSON', () => {
    const row = toRow(setInfluence({ ...blankState(ADVENTURE), loop: 5, slot: 2 }, 4, 8));
    expect(row).toMatchObject({ loop: 5, slot: 2, influencePoints: 4, influenceHighWater: 4 });
    expect(row.detail).not.toHaveProperty('loop');
    expect(row.detail).not.toHaveProperty('slot');
  });

  it('reads a row that has never been written as an empty run', () => {
    const back = fromRow({ loop: 1, slot: 1, influencePoints: 0, influenceHighWater: 0, detail: '{}' });
    expect(back.faults).toEqual({});
    expect(back.influence.discovered).toEqual([]);
  });
});

describe('beats', () => {
  const WITH_BEATS = { ...ADVENTURE, beats: [{ id: 'soup' }, { id: 'burns' }] };

  it('start un-landed', () => {
    expect(blankState(WITH_BEATS).beats).toEqual({ soup: false, burns: false });
  });

  it('survive a reset, unlike a fix', () => {
    const before = { ...blankState(WITH_BEATS), beats: { soup: true, burns: false } };
    expect(resetLoop(before).beats).toEqual({ soup: true, burns: false });
  });

  it('round-trip through the database', () => {
    const state = { ...blankState(WITH_BEATS), beats: { soup: true, burns: true } };
    const row = toRow(state);
    expect(fromRow({ ...row, detail: JSON.stringify(row.detail) }).beats).toEqual({ soup: true, burns: true });
  });

  it('read back as empty for an adventure that has none', () => {
    expect(blankState({ faults: [] }).beats).toEqual({});
  });
});
