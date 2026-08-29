-- Off-Guard initial schema.
--
-- Campaign is a first-class object from the first migration, not a column added
-- later: every row that belongs to a table's game carries `campaign_id`, and
-- every query the server makes is filtered by the scope resolved from the URL
-- token rather than by an id the client sent.
--
-- Global by design, with no campaign_id: creature data, reference tables and
-- homebrew. Those live in files, not here, except for homebrew (later
-- migration) which is deliberately shared across campaigns.

CREATE TABLE campaign (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  adventure        TEXT,                       -- adventure path or module name
  chapter          TEXT,                       -- current chapter or session number
  party_level      INTEGER NOT NULL DEFAULT 1,
  accent_color     TEXT    NOT NULL DEFAULT '#667EEA',
  notes            TEXT    NOT NULL DEFAULT '',
  next_session_at  TEXT,                       -- ISO 8601
  last_played_at   TEXT,
  archived_at      TEXT,                       -- archived, never deleted
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Access tokens.
--
-- Stored in the clear. The token protects data that lives in this same file, so
-- hashing it would not raise the bar for anyone who has the file, and it would
-- stop the dashboard re-displaying a player's link when they lose it -- which
-- is a real workflow, and rotation is the answer to compromise.
--
-- kind:
--   'gm'         one token, no campaign, reaches every campaign
--   'character'  one character in one campaign
--   'table'      one campaign's shared initiative screen, read-only
CREATE TABLE token (
  id            INTEGER PRIMARY KEY,
  token         TEXT    NOT NULL UNIQUE,
  kind          TEXT    NOT NULL CHECK (kind IN ('gm', 'character', 'table')),
  campaign_id   INTEGER REFERENCES campaign(id) ON DELETE CASCADE,
  character_id  INTEGER,                       -- FK added with the character table
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  revoked_at    TEXT,                          -- rotation invalidates immediately

  -- A GM token is global; every other kind must name its campaign. Enforced
  -- here so a scoping mistake in application code cannot produce a token that
  -- reaches everything.
  CHECK (
    (kind = 'gm'  AND campaign_id IS NULL AND character_id IS NULL) OR
    (kind = 'table'     AND campaign_id IS NOT NULL AND character_id IS NULL) OR
    (kind = 'character' AND campaign_id IS NOT NULL AND character_id IS NOT NULL)
  )
);

CREATE INDEX token_lookup ON token(token) WHERE revoked_at IS NULL;
CREATE INDEX token_by_campaign ON token(campaign_id, kind);

-- One shared initiative screen per campaign, so the Tuesday group never sees
-- the Saturday group's fight.
CREATE UNIQUE INDEX token_one_table_view_per_campaign
  ON token(campaign_id) WHERE kind = 'table' AND revoked_at IS NULL;

CREATE UNIQUE INDEX token_one_gm ON token(kind) WHERE kind = 'gm' AND revoked_at IS NULL;

CREATE TABLE character (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  -- A character belongs to exactly one campaign. The same person playing in two
  -- campaigns has two characters and two links, which is correct.
  player_name  TEXT    NOT NULL DEFAULT '',
  name         TEXT    NOT NULL DEFAULT '',
  level        INTEGER NOT NULL DEFAULT 1,
  sheet        TEXT    NOT NULL DEFAULT '{}',  -- the whole sheet, as JSON
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX character_by_campaign ON character(campaign_id, sort_order);

-- Per-field versioning, so a GM pushing a condition does not clobber a note the
-- player is in the middle of typing. A write carries the version it was based
-- on; a mismatch is reported for that path alone rather than failing the sheet.
CREATE TABLE character_field (
  character_id  INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  path          TEXT    NOT NULL,              -- e.g. 'hp.current', 'notes'
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by    TEXT    NOT NULL DEFAULT 'player' CHECK (updated_by IN ('player', 'gm', 'import')),
  PRIMARY KEY (character_id, path)
) WITHOUT ROWID;

CREATE TABLE encounter (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL DEFAULT 'Untitled encounter',
  adventure    TEXT,                           -- grouping within the campaign
  chapter      TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT    NOT NULL DEFAULT '',
  terrain      TEXT    NOT NULL DEFAULT '',
  lighting     TEXT    NOT NULL DEFAULT '',
  treasure     TEXT    NOT NULL DEFAULT '',
  -- Overrides for a one-shot; null means "read it from the party sheets".
  party_level_override INTEGER,
  party_size_override  INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX encounter_by_campaign ON encounter(campaign_id, sort_order);

CREATE TABLE encounter_creature (
  id            INTEGER PRIMARY KEY,
  encounter_id  INTEGER NOT NULL REFERENCES encounter(id) ON DELETE CASCADE,
  creature_id   TEXT    NOT NULL,              -- id in data/creatures, or homebrew
  display_name  TEXT    NOT NULL DEFAULT '',   -- "Goblin A"
  adjustment    TEXT    CHECK (adjustment IN ('elite', 'weak')),
  level_scale   INTEGER NOT NULL DEFAULT 0 CHECK (level_scale BETWEEN -4 AND 4),
  count         INTEGER NOT NULL DEFAULT 1,
  notes         TEXT    NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX encounter_creature_by_encounter ON encounter_creature(encounter_id, sort_order);

-- Initiative state. One live combat per campaign at a time; finished ones are
-- kept so a session can be reconstructed.
CREATE TABLE combat (
  id            INTEGER PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  encounter_id  INTEGER REFERENCES encounter(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL DEFAULT '',
  round         INTEGER NOT NULL DEFAULT 1,
  turn_index    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT
);

CREATE INDEX combat_by_campaign ON combat(campaign_id, active);
CREATE UNIQUE INDEX combat_one_active_per_campaign
  ON combat(campaign_id) WHERE active = 1;

CREATE TABLE combatant (
  id            INTEGER PRIMARY KEY,
  combat_id     INTEGER NOT NULL REFERENCES combat(id) ON DELETE CASCADE,
  character_id  INTEGER REFERENCES character(id) ON DELETE SET NULL,
  creature_id   TEXT,                           -- null for a player character
  display_name  TEXT    NOT NULL DEFAULT '',
  initiative    REAL,
  sort_order    INTEGER NOT NULL DEFAULT 0,     -- ties resolved by drag
  hp_current    INTEGER,
  hp_max        INTEGER,
  hp_temp       INTEGER NOT NULL DEFAULT 0,
  conditions    TEXT    NOT NULL DEFAULT '[]',  -- JSON: [{slug, value}]
  dying         INTEGER NOT NULL DEFAULT 0,
  wounded       INTEGER NOT NULL DEFAULT 0,
  hero_points   INTEGER NOT NULL DEFAULT 0,
  state         TEXT    NOT NULL DEFAULT 'normal' CHECK (state IN ('normal', 'delayed', 'ready')),
  notes         TEXT    NOT NULL DEFAULT '',
  -- What reaches the shared screen. Hidden combatants are absent from the
  -- player view entirely, not blanked out in place.
  visible       INTEGER NOT NULL DEFAULT 1,
  hp_numeric    INTEGER NOT NULL DEFAULT 0,     -- show a number instead of a descriptor
  revealed      TEXT    NOT NULL DEFAULT '[]',  -- JSON: revealed Recall Knowledge fact keys
  stat_block    TEXT                            -- JSON snapshot, so a rebuild cannot change a live fight
);

CREATE INDEX combatant_by_combat ON combatant(combat_id, sort_order);

CREATE TABLE session_log (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  played_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  title        TEXT    NOT NULL DEFAULT '',
  body         TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX session_log_by_campaign ON session_log(campaign_id, played_at DESC);

-- Failed token lookups, for rate limiting and for noticing someone guessing.
CREATE TABLE access_failure (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  ip           TEXT    NOT NULL DEFAULT '',
  path         TEXT    NOT NULL DEFAULT '',
  -- The first characters only. Enough to correlate a repeated guess, not enough
  -- to reconstruct a token from the log.
  token_prefix TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX access_failure_recent ON access_failure(at DESC);
