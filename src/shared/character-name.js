/**
 * What to call a character.
 *
 * A character can exist before it has a name. That is the point: a GM who
 * knows their players but not yet their characters can add a row per person,
 * hand out the links, and let each player import or type the rest — including
 * the character's name — into a sheet that is already theirs.
 *
 * So four places have to render something for a character with no name of its
 * own: the party panel, the links panel, the roster, and the shared screen.
 * Shared rather than repeated, because they must agree — a link labelled one
 * thing and a row labelled another is how the wrong link gets sent.
 *
 * The player's name is the fallback, phrased as belonging to them, because
 * that is the only thing anybody knows yet and it is what the GM typed.
 */

/**
 * @param {{ name?: string, playerName?: string }} character
 * @returns {string} never empty
 */
export function displayName(character) {
  const own = String(character?.name ?? '').trim();
  if (own) return own;

  const player = String(character?.playerName ?? '').trim();
  // "Alex’s character" rather than "Alex": on a list beside named characters,
  // a bare player name reads as a character called Alex.
  if (player) return `${player}${/s$/i.test(player) ? '’' : '’s'} character`;

  return 'Unnamed character';
}

/** True while a character is still going by its player's name. */
export function isUnnamed(character) {
  return !String(character?.name ?? '').trim();
}
