-- Which devices a link has been opened from.
--
-- The access model is that the URL is the credential, which is defensible for
-- a table of people who know each other and has one honest weakness: a link in
-- a screenshot, a browser history sync or a shared screen is a working link
-- for whoever sees it, forever, and nothing in the application would ever
-- notice.
--
-- This is the first half of the answer. A link now remembers the devices that
-- have used it, so the GM can see that Kestrel's link has been opened from two
-- devices when Kestrel has one -- and `locked_at` is the second half: a link
-- that is locked accepts only the devices already on its list.
--
-- Recorded first and enforced second, deliberately. A link that binds to the
-- first device that opens it is the strongest version of this and would strand
-- a player whose phone cleared its cookies halfway through a session, with the
-- remedy sitting behind a dashboard they cannot reach. Visibility costs nobody
-- anything; enforcement is a switch per link, thrown where it is worth it.
--
-- A cookie is not a replacement for the token, and must never become one. The
-- secret path is also what makes this application immune to cross-site request
-- forgery: a page that cannot address a request cannot forge one. A cookie
-- alone would be sent by the browser to anybody who asked. So both are
-- required and the cookie is only ever a second factor.

CREATE TABLE token_device (
  id             INTEGER PRIMARY KEY,
  token_id       INTEGER NOT NULL REFERENCES token(id) ON DELETE CASCADE,

  -- sha256(token_id || ':' || the device's secret), not the secret alone.
  --
  -- The salt is the point. One browser that opens two links in this campaign
  -- produces two unrelatable rows, so this table cannot answer "which links
  -- has this person opened" -- a question the feature never needs and the GM
  -- was never offered an answer to. It also means a copied database contains
  -- no value that can be replayed as a cookie, for the same reason the tokens
  -- themselves are hashed.
  device_hash    TEXT    NOT NULL,

  -- What can honestly be said about the device, and nothing more: "iPhone ·
  -- Safari", derived from the user agent and thrown away. Not the agent
  -- string, not an address. The GM needs to tell two devices apart, which is a
  -- much smaller thing than knowing whose they are.
  label          TEXT    NOT NULL DEFAULT '',

  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE (token_id, device_hash)
);

CREATE INDEX token_device_by_token ON token_device(token_id, last_seen_at DESC);

-- When enforcement was turned on for this link. NULL means the link records
-- devices and refuses none, which is what every existing link gets.
ALTER TABLE token ADD COLUMN locked_at TEXT;
