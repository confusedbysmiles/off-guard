-- The loop console.
--
-- A looping adventure -- one where the evening resets and the party keeps its
-- memories -- needs one thing a session log and an initiative tracker cannot
-- give it: a record of what survives a reset and what does not. The party
-- remembers the wine is a fake; the decanter is full of fig wine again.
--
-- Kept server-side rather than in the browser for the same reason the dice log
-- is: state that lives in one browser is state the GM loses by prepping on the
-- laptop and running from the desk machine.
--
-- Scoped to a campaign like everything else, and additionally keyed by an
-- adventure id, because one campaign can run more than one looping adventure
-- and a one-shot dropped into an ongoing campaign is the common case.
CREATE TABLE loop_run (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  -- Matches the `id` of the adventure definition the dashboard loaded, e.g.
  -- 'nine-minutes-to-the-toast'. Text rather than a foreign key: adventure
  -- definitions are files that ship with the front end, not rows.
  adventure_id TEXT    NOT NULL,
  title        TEXT    NOT NULL DEFAULT '',

  -- The spine. These get columns rather than living in `detail` because they
  -- are the same shape for every looping adventure, and because a cross-campaign
  -- view answering "which table is mid-loop" should not have to parse JSON.
  loop         INTEGER NOT NULL DEFAULT 1 CHECK (loop >= 1),
  slot         INTEGER NOT NULL DEFAULT 1 CHECK (slot >= 1),

  -- Influence points reset with the loop; the high-water mark does not. Two
  -- columns rather than one, because the whole point of the subsystem here is
  -- that reaching a threshold once makes reaching it again cheap.
  influence_points     INTEGER NOT NULL DEFAULT 0 CHECK (influence_points >= 0),
  influence_high_water INTEGER NOT NULL DEFAULT 0 CHECK (influence_high_water >= 0),

  -- Everything whose shape the adventure file defines rather than this schema:
  -- which faults exist and their known/fixed/sticky flags, which influence
  -- discoveries have been made, the per-loop slot log, and the party's names.
  -- Same reasoning as `roll.detail` -- normalising it would hard-code this
  -- console's idea of a fault into the database, and the adventure definition
  -- is the thing that owns that idea.
  detail       TEXT    NOT NULL DEFAULT '{}',

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One run per adventure per campaign. Running the same one-shot for the Tuesday
-- and Saturday groups gives two independent runs, which is the point.
CREATE UNIQUE INDEX loop_run_by_adventure ON loop_run(campaign_id, adventure_id);
