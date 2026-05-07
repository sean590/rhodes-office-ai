-- Migration 039: Soft-delete support for directory entries
--
-- Mirrors the documents.deleted_at pattern. Enables archive_directory_entry
-- in the apply.ts action catalog without losing references from historical
-- allocations / co-investor records. Directory queries should filter
-- deleted_at IS NULL.

ALTER TABLE directory_entries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_directory_entries_deleted_at
  ON directory_entries (deleted_at)
  WHERE deleted_at IS NULL;
