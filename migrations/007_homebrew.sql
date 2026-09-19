-- Options the GM wrote, which no book contains.
--
-- 001 said homebrew was coming in a later migration and that it would be
-- global across campaigns, like creature data. This is that migration, and it
-- does the opposite: `campaign_id` is NOT NULL and every read is filtered by
-- it.
--
-- The reason for changing that decision is that these are not the same kind of
-- thing as a monster. A stat block is a tool the GM picks up and puts down; an
-- ancestry is part of a setting. A Tuesday game's Ashen-Blooded heritage
-- appearing in a Thursday game's picker is not a convenience, it is a leak of
-- one table's fiction into another's -- and the player who chose it would have
-- no way to know it was not a real option. Scoped, a picker shows exactly the
-- options that table has.
--
-- `record` is the whole option document as JSON, in the shape `data/options/`
-- uses, rather than a column per field. Four kinds with almost no overlap
-- would otherwise be four tables or one table of mostly-NULL columns, and the
-- records are only ever read whole: the overlay in src/server/homebrew.js
-- hands them to the same code that reads a catalogue record, which is the
-- entire point. What is in the JSON is not the browser's to decide -- see
-- `homebrewRecord`, which builds it field by field from what the rules can
-- actually read.
--
-- `name` and `kind` are columns as well as JSON keys, because listing and
-- searching sort and filter on them, and json_extract in an ORDER BY over
-- every row of a table that a picker reads on each keystroke is a cost with
-- nothing to show for it.

CREATE TABLE homebrew (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL
               CHECK (kind IN ('ancestry', 'heritage', 'background', 'class')),
  name         TEXT    NOT NULL,
  record       TEXT    NOT NULL,              -- the option document, as JSON
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Every query this table serves starts "what has this campaign got", including
-- the one the builder makes on each keystroke of a search.
CREATE INDEX homebrew_by_campaign ON homebrew(campaign_id, kind, name);

-- Deliberately not unique on (campaign_id, kind, name). Two backgrounds called
-- "Caravan guard" is a mistake, but it is the GM's mistake to make and to fix,
-- and a constraint that refuses a save halfway through writing one is a worse
-- experience than a duplicate in a list. An option's identity is its row id,
-- which is what a build stores, so a rename never orphans a character.
