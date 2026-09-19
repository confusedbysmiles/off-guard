/**
 * A campaign's own options, laid over the catalogue.
 *
 * The builder asks one thing for its options -- `app.builderOptions` -- and
 * everything downstream of that is written against one interface: search, get,
 * getMany, has, progressionFor. This wraps that interface so a campaign with
 * homebrew gets the catalogue plus its own entries through the same five
 * functions, and nothing that reads an option record needs to know which it
 * got. `deriveCharacter` is handed an ancestry; whether the GM wrote it is not
 * a question it should have to ask.
 *
 * Campaign-scoped, and the campaign id never comes from the client. It is read
 * off the scope the token resolved to -- see `scope.js` -- so a player's
 * builder sees their own table's options and there is no parameter to tamper
 * with, because there is no parameter.
 */
import { searchRows } from './options.js';
import { homebrewRow } from '../rules/character/homebrew.js';

/**
 * @param {object} options  the global catalogue, from `openOptions`
 * @param {Array}  entries  this campaign's rows: `{ id, record }`
 */
export function withHomebrew(options, entries = []) {
  /**
   * The common case is a campaign with no homebrew at all, and the honest
   * thing to do with it is nothing. Returning the catalogue itself means a
   * table that has never written an option pays not one array copy, one extra
   * function call or one changed behaviour for the existence of this file.
   */
  if (!entries.length) return options;

  const records = new Map(entries.map((entry) => [entry.id, entry.record]));
  const rows = entries.map((entry) => homebrewRow(entry.record, entry.id));

  /**
   * One list, searched once.
   *
   * Concatenating 17,000 catalogue rows with a handful costs a shallow copy
   * per search, measured at well under a millisecond and under a keystroke.
   * The alternative -- searching both and merging the results -- has to redo
   * the sort and the pagination, and gets the second page wrong when it
   * doesn't. Homebrew first, so a tie in the sort falls towards the table's
   * own.
   */
  const all = [...rows, ...(options.rows ?? [])];

  return {
    ...options,
    rows: all,
    search: (query) => searchRows(all, query),
    get: (id) => records.get(id) ?? options.get(id),
    getMany: (ids = []) => ids.map((id) => records.get(id) ?? options.get(id)).filter(Boolean),
    has: (id) => records.has(id) || options.has(id),
    /**
     * A homebrew class carries the advancement table it was built from, so
     * this never falls through to the catalogue for one -- which matters,
     * because `class:hb-3` is not a key the catalogue has ever heard of and
     * a miss there would be an unadvancing character rather than an error.
     */
    progressionFor: (id) => (records.has(id)
      ? records.get(id).progression ?? null
      : options.progressionFor(id)),
    classes: () => [
      ...rows.filter((row) => row.kind === 'class')
        .map((row) => ({ id: row.id, name: row.name, rarity: row.rarity, book: row.book })),
      ...options.classes(),
    ],
    stats: () => ({ ...options.stats(), homebrew: entries.length }),
  };
}
