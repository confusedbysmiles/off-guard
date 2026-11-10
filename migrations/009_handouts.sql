-- Handouts: the letters, maps and player aids a table passes round.
--
-- Stored here rather than linked to Google Drive or a GitHub repository, for
-- the reason the whole access model exists: a player holds exactly one link
-- and that link is the whole credential. A Drive folder is either public to
-- the internet or needs a Google account per player, and either way it is a
-- second way in to maintain for five people who need none.
--
-- The bytes live in the database rather than beside it. The backup tool
-- produces one consistent file with no sidecars, and restoring it is the whole
-- of the migration story -- `deploy/MIGRATING.md` turns on that being true. A
-- directory of PDFs next to the database would be a second thing to copy and
-- therefore, eventually, the thing somebody forgot to copy. SQLite carries a
-- few tens of megabytes of blob without complaint, and `npm run backup` keeps
-- covering everything for free.
--
-- `released_at` is the second half, and is null by default. A handout is the
-- GM's until they hand it over: the letter found in Act 2 should not be
-- readable from the character sheet in Act 1. Same shape as a hidden
-- combatant -- recorded, and withheld until it is time.

CREATE TABLE handout (
  id            INTEGER PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,

  title         TEXT    NOT NULL,
  -- What it was called on disk, kept so a download arrives with a name the
  -- player recognises rather than `handout-7`.
  filename      TEXT    NOT NULL,
  content_type  TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  bytes         BLOB    NOT NULL,

  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- Null until the GM releases it. Not a boolean, because "when did the party
  -- get this" is worth knowing when writing the session up.
  released_at   TEXT,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Every read is "this campaign's handouts, in order".
CREATE INDEX handout_by_campaign ON handout(campaign_id, sort_order, id);
