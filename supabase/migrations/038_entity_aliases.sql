-- Migration 038: Aliases (AKAs) on entities
--
-- Mirrors the directory_entries.aliases pattern. Primarily used for person
-- entities so the document analysis system can match on alternate names
-- ("Sean", "Sean Doherty", "S. Doherty"), but the column is available to
-- any entity type — useful for LLCs that are commonly known by a former
-- name or a doing-business-as.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
