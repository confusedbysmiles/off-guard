-- Tokens at rest become hashes.
--
-- Until now the token column held the link itself, so anyone holding the
-- database file held every working link in it: a backup, a stray WAL, a support
-- dump. Storing the SHA-256 instead means a copied database contains nothing
-- that opens a door.
--
-- A plain SHA-256 and not bcrypt: see the note on `hashToken` in
-- src/server/tokens.js. The short version is that a 128-bit random token has
-- nothing to guess at, so a slow hash would buy nothing and would cost a delay
-- on every request including every SSE reconnect.
--
-- The cost of this change, stated plainly: a link can no longer be shown twice.
-- The GM sees it once, when it is minted or rotated, and after that the only way
-- to give a player their link again is to rotate it and hand them a new one.
-- That is the trade hashing makes, and rotation is the answer to it.
--
-- SQLite cannot drop a column that an index depends on, so the table is rebuilt.
-- Nothing has a foreign key pointing at `token`, which is what makes that safe.
-- `sha256()` is registered on the connection in src/server/db.js.

CREATE TABLE token_hashed (
  id            INTEGER PRIMARY KEY,
  token_hash    TEXT    NOT NULL UNIQUE,
  kind          TEXT    NOT NULL CHECK (kind IN ('gm', 'character', 'table')),
  campaign_id   INTEGER REFERENCES campaign(id) ON DELETE CASCADE,
  character_id  INTEGER,
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  revoked_at    TEXT,

  CHECK (
    (kind = 'gm'        AND campaign_id IS NULL     AND character_id IS NULL) OR
    (kind = 'table'     AND campaign_id IS NOT NULL AND character_id IS NULL) OR
    (kind = 'character' AND campaign_id IS NOT NULL AND character_id IS NOT NULL)
  )
);

INSERT INTO token_hashed
  (id, token_hash, kind, campaign_id, character_id, note, created_at, last_used_at, revoked_at)
SELECT
  id, sha256(token), kind, campaign_id, character_id, note, created_at, last_used_at, revoked_at
FROM token;

DROP TABLE token;

ALTER TABLE token_hashed RENAME TO token;

CREATE INDEX token_lookup ON token(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX token_by_campaign ON token(campaign_id, kind);

CREATE UNIQUE INDEX token_one_table_view_per_campaign
  ON token(campaign_id) WHERE kind = 'table' AND revoked_at IS NULL;

CREATE UNIQUE INDEX token_one_gm ON token(kind) WHERE kind = 'gm' AND revoked_at IS NULL;
