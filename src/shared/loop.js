/**
 * Looping adventures: what a reset keeps and what it throws away.
 *
 * Shared because both sides need the same answer. The dashboard applies these
 * transitions as the GM works, and the server test suite holds them to the
 * rule, which is the only part of the loop console that can be wrong in a way
 * nobody notices until the table is halfway through the evening.
 *
 * The rule, stated once:
 *
 *   The party remembers. The world does not.
 *
 * So `known` on a fault survives a reset and `fixed` does not; influence points
 * reset and the high-water mark does not; and a `sticky` fault -- one solved by
 * removing its cause rather than its symptom -- re-applies itself at the top of
 * every later loop. That last one is the only case where the world remembers
 * too, and it is worth a table noticing.
 */

/** The state a run starts in, given an adventure definition. */
export function blankState(adventure) {
  const faults = {};
  for (const fault of adventure.faults ?? []) {
    faults[fault.id] = { known: false, fixed: false, sticky: false };
  }
  return {
    loop: 1,
    slot: 1,
    party: [...(adventure.party ?? [])],
    faults,
    influence: { points: 0, highWater: 0, discovered: [] },
    log: {},
  };
}

/**
 * Burn the room.
 *
 * Returns a new state; does not mutate. A sticky fault comes back already
 * fixed, because killing the thing in the cold room is not something the loop
 * can undo.
 */
export function resetLoop(state) {
  const faults = {};
  for (const [id, fault] of Object.entries(state.faults ?? {})) {
    faults[id] = { ...fault, fixed: Boolean(fault.sticky) };
  }
  return {
    ...state,
    loop: (state.loop ?? 1) + 1,
    slot: 1,
    faults,
    influence: { ...state.influence, points: 0 },
  };
}

/**
 * Record influence, keeping the high-water mark.
 *
 * Clamped at both ends: the subsystem has no notion of negative standing, and
 * a threshold above the adventure's maximum is not reachable.
 */
export function setInfluence(state, points, max) {
  const next = Math.min(max, Math.max(0, points));
  return {
    ...state,
    influence: {
      ...state.influence,
      points: next,
      highWater: Math.max(state.influence?.highWater ?? 0, next),
    },
  };
}

/** Every fault fixed at once, which is the win condition. */
export function isPerfectRun(state, adventure) {
  const faults = adventure.faults ?? [];
  if (!faults.length) return false;
  return faults.every((fault) => state.faults?.[fault.id]?.fixed);
}

/**
 * Split a state into the columns the database keeps and the JSON it does not.
 * The spine is queryable; the adventure-shaped rest is not.
 */
export function toRow(state) {
  const { loop, slot, influence, ...rest } = state;
  return {
    loop: loop ?? 1,
    slot: slot ?? 1,
    influencePoints: influence?.points ?? 0,
    influenceHighWater: influence?.highWater ?? 0,
    detail: { ...rest, discovered: influence?.discovered ?? [] },
  };
}

/** The inverse of `toRow`, for reading a run back out of the database. */
export function fromRow(row) {
  const detail = typeof row.detail === 'string' ? JSON.parse(row.detail || '{}') : (row.detail ?? {});
  const { discovered = [], ...rest } = detail;
  return {
    loop: row.loop,
    slot: row.slot,
    party: rest.party ?? [],
    faults: rest.faults ?? {},
    log: rest.log ?? {},
    influence: {
      points: row.influencePoints,
      highWater: row.influenceHighWater,
      discovered,
    },
  };
}
