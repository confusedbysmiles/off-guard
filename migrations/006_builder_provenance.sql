-- The builder becomes a fourth way a field can be written.
--
-- `character_field.updated_by` records who last touched a path, and it was
-- constrained to the three writers that existed: the player typing, the GM
-- pushing a condition, and a Pathbuilder import. The character builder is a
-- fourth, and a genuinely distinct one -- a field it owns was not typed by
-- anyone and did not come from another application, it was derived from the
-- character's own choices. Recording that as 'player' would make the sheet's
-- provenance a lie in exactly the places a player is most likely to ask why a
-- number is what it is.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
-- `character_field` is referenced by nothing -- no foreign key points at it --
-- and it carries no index beyond its primary key, which makes the rebuild a
-- straight copy.

CREATE TABLE character_field_new (
  character_id  INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  path          TEXT    NOT NULL,              -- e.g. 'hp.current', 'notes'
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by    TEXT    NOT NULL DEFAULT 'player'
                CHECK (updated_by IN ('player', 'gm', 'import', 'builder')),
  PRIMARY KEY (character_id, path)
) WITHOUT ROWID;

INSERT INTO character_field_new (character_id, path, version, updated_at, updated_by)
  SELECT character_id, path, version, updated_at, updated_by FROM character_field;

DROP TABLE character_field;
ALTER TABLE character_field_new RENAME TO character_field;
