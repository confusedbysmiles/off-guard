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
  // Beats are the one kind of progress that is neither a fault nor a fix: they
  // land once in the evening and no reset takes them back.
  const beats = {};
  for (const beat of adventure.beats ?? []) beats[beat.id] = false;

  return {
    loop: 1,
    slot: 1,
    party: [...(adventure.party ?? [])],
    faults,
    beats,
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
    beats: rest.beats ?? {},
    log: rest.log ?? {},
    influence: {
      points: row.influencePoints,
      highWater: row.influenceHighWater,
      discovered,
    },
  };
}

// --- the clock ---------------------------------------------------------------
//
// Shared for the same reason the reset rules are: two screens show this clock
// now. The GM advances it on the dashboard and the room reads it off the
// television, and a minute that disagrees between the two is the one thing
// nobody at the table can resolve by looking harder.

/** `"7:51"` -> minutes past midnight, 24-hour, evening assumed. */
function parseStart(label) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(label ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  // These labels carry no AM or PM, and "7:51" is a dinner party rather than a
  // breakfast one, so an hour before noon is read as the evening. A loop that
  // runs past midnight keeps counting into the small hours rather than jumping
  // back twelve.
  return ((hour < 12 ? hour + 12 : hour) * 60) + Number(match[2]);
}

/**
 * The face of the clock at a slot: `{ text: '7:57', suffix: 'PM' }`.
 *
 * Derived from the adventure's own `startLabel` rather than a constant, so a
 * second adventure that does not start at ten to eight works without anybody
 * remembering there was a number to change.
 */
export function clockFace(adventure, slot) {
  const start = parseStart(adventure?.loop?.startLabel);
  if (start === null) return null;

  const total = start + (Math.max(1, Number(slot) || 1) - 1);
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const hour12 = ((hour24 + 11) % 12) + 1;
  return {
    text: `${hour12}:${String(minute).padStart(2, '0')}`,
    suffix: hour24 >= 12 ? 'PM' : 'AM',
  };
}

/** The event that fires when the clock reaches this slot, if any. */
export function eventAt(adventure, slot) {
  return (adventure?.loop?.events ?? []).find((event) => event.slot === slot) ?? null;
}
