-- The campaign's own calendar: where the party is in the year, and what is
-- marked on it.
--
-- A date here is Golarion's, written `4725-09-14` -- Absalom Reckoning, the
-- months and leap rule from GM Core page 146. Text rather than a day number
-- because it sorts the same either way and a person reading the database can
-- see what it says. It is never an ISO timestamp and is never compared to
-- one: `next_session_at` beside it is a real-world date and they measure
-- different things. The year makes them easy to tell apart on sight.
--
-- `in_world_date` is null until a GM sets one, and a campaign with none simply
-- has no calendar -- the tab says so rather than inventing a year. Most tables
-- never set it, and a date nobody chose showing up on the shared screen as
-- though it were the party's would be worse than an empty tab.

ALTER TABLE campaign ADD COLUMN in_world_date TEXT;

-- What is marked on the calendar.
--
-- `shared` is the half that matters and defaults to 0, the same shape as a
-- handout's `released_at` and a hidden combatant: an event is the GM's until
-- they hand it over, so the day the cult completes its ritual can sit on the
-- calendar for weeks before the party has any business knowing about it.
--
-- `ends_at` is null for the ordinary case of something that happens on a day.
-- A journey, a siege or a festival that runs a week sets it, and every day
-- from `at` to `ends_at` is marked.
CREATE TABLE campaign_event (
  id           INTEGER PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,

  at           TEXT    NOT NULL,                  -- '4725-09-14'
  ends_at      TEXT,                              -- null unless it spans days

  title        TEXT    NOT NULL DEFAULT '',
  body         TEXT    NOT NULL DEFAULT '',
  shared       INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX campaign_event_by_campaign ON campaign_event(campaign_id, at);
