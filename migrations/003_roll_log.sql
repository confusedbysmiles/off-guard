-- The dice log.
--
-- Server-side rather than in the browser's storage, for one reason: a roll the
-- table can see has to reach the shared screen, and a secret roll has to not.
-- That distinction only means anything if there is one log both surfaces read
-- from, and the server decides what leaves it.
--
-- Scoped to a campaign like everything else. A roll made on Tuesday's game must
-- not appear on Thursday's screen.
CREATE TABLE roll (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  -- What was rolled for: "Goblin Warrior B, jaws" or "Perception". Free text,
  -- because the roller is used for things the application knows nothing about.
  label        TEXT    NOT NULL DEFAULT '',
  -- The canonical form the parser produced, not what was typed.
  expression   TEXT    NOT NULL,
  -- The whole result from the rules engine, including the dice a `kh` term
  -- dropped, so the log can show what was on the table.
  detail       TEXT    NOT NULL DEFAULT '{}',
  total        INTEGER NOT NULL,
  secret       INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1)),
  -- A halved or doubled total is recorded as its own entry pointing at the roll
  -- it came from, rather than by editing that roll: a critical hit is a thing
  -- that happened after the dice landed, and the log should read that way.
  derived_from INTEGER REFERENCES roll(id) ON DELETE CASCADE,
  derivation   TEXT    CHECK (derivation IS NULL OR derivation IN ('half', 'double')),
  rolled_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX roll_by_campaign ON roll(campaign_id, id DESC);
