-- Persistent damage on a combatant.
--
-- Deferred from the initiative tracker: the rules engine and the end-of-turn
-- prompt were both written for it, but nothing stored it, so the prompt could
-- never fire. JSON rather than a table because it is a short list read and
-- written whole, always with its combatant, and never queried across rows.
--
-- Each entry: { formula, type, dc }. The DC is stored per entry because an
-- effect can specify something other than the standard flat 15.
ALTER TABLE combatant ADD COLUMN persistent_damage TEXT NOT NULL DEFAULT '[]';
