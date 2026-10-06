/**
 * A character, as a file.
 *
 * Off-Guard could read a Pathbuilder export and could not produce one of its
 * own, which meant a character existed in exactly one place: this server's
 * SQLite file. That is a fine place for it to live and a poor place for it to
 * live *only* -- a player who wants to take their character to another table,
 * or who would like a copy of their own, had no way to get one that did not
 * involve the GM and a database.
 *
 * A character is about five kilobytes of JSON, so this needs no format
 * cleverness: the sheet, whole, inside an envelope that says what it is.
 *
 * The envelope is the part that earns its place. Without it, an Off-Guard file
 * and a Pathbuilder file are both "some JSON a player chose", and the import
 * has to guess from their shape -- which works until it doesn't, and then
 * quietly maps the wrong fields. With it, the import knows which it has before
 * reading a single value, and a file that is neither gets a sentence saying so.
 */

export const FORMAT = 'off-guard-character';
export const FORMAT_VERSION = 1;

/**
 * What a character file holds, and what it deliberately does not.
 *
 * The sheet and the identity a player would recognise. No token: a link is a
 * credential, and a credential in a file a player is encouraged to email
 * themselves is the one mistake this feature could make that would matter. No
 * character id and no campaign id either -- those name a row in one particular
 * database, and a file that carries them invites a restore into the wrong
 * character on the grounds that the numbers matched.
 */
export function exportCharacter(character, { exportedAt = new Date() } = {}) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    character: {
      name: character?.name ?? '',
      playerName: character?.playerName ?? '',
      level: Number(character?.level ?? 1),
      sheet: character?.sheet ?? {},
    },
  };
}

/** Whether this parsed JSON claims to be one of ours. */
export const isPortable = (value) => Boolean(value)
  && typeof value === 'object'
  && value.format === FORMAT;

/**
 * The sheet inside a character file, checked.
 *
 * A version from the future is refused rather than read optimistically: a file
 * written by a later Off-Guard may mean something different by a field this
 * one recognises, and "restored successfully" over a character that is now
 * subtly wrong is worse than "this file is newer than this server".
 */
export function readPortable(value) {
  if (!isPortable(value)) {
    return { sheet: null, error: 'That is not an Off-Guard character file.' };
  }

  const version = Number(value.version);
  if (!Number.isFinite(version) || version < 1) {
    return { sheet: null, error: 'That character file does not say which version it is.' };
  }
  if (version > FORMAT_VERSION) {
    return {
      sheet: null,
      error: `That file was written by a newer Off-Guard (format ${version}; this one reads ${FORMAT_VERSION}).`,
    };
  }

  const sheet = value.character?.sheet;
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return { sheet: null, error: 'That character file has no sheet in it.' };
  }

  return {
    sheet,
    error: null,
    name: String(value.character?.name ?? ''),
    playerName: String(value.character?.playerName ?? ''),
    exportedAt: value.exportedAt ?? null,
  };
}

/**
 * What to call the file.
 *
 * The character's name and the date, which is what somebody with six of these
 * in a downloads folder needs to tell them apart.
 */
export function fileNameFor(character, { exportedAt = new Date() } = {}) {
  const slug = String(character?.name ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  return `${slug}-${exportedAt.toISOString().slice(0, 10)}.json`;
}
