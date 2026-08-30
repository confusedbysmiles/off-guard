/**
 * The adventures the loop console knows how to run.
 *
 * A registry rather than a dynamic import, because the id that selects one
 * arrives from a database row: `import(`./${id}.js`)` with a value from
 * storage is a path traversal waiting for someone to write the wrong row.
 * Adding an adventure is a file beside this one and a line in the map.
 *
 * These live under `src/shared/` rather than beside the dashboard because the
 * server needs them too. The shared screen shows the clock and what the party
 * has worked out, and the rule for that screen has always been that the payload
 * contains only what players may see -- the way secret rolls are dropped from
 * it rather than sent with a flag. Resolving fault names on the server keeps it
 * that way: a player who opens the shared screen on their own phone and reads
 * the source finds nothing, because the adventure was never sent.
 */
import { ADVENTURE as NINE_MINUTES } from './nine-minutes.js';

export const ADVENTURES = {
  [NINE_MINUTES.id]: NINE_MINUTES,
};

/** The definition for an id, or null. Never throws on an unknown id. */
export function adventureById(id) {
  return Object.prototype.hasOwnProperty.call(ADVENTURES, id) ? ADVENTURES[id] : null;
}
