-- Account offboarding: org soft-delete with a 30-day recoverable grace.
--
-- Deleting an account (org) is a two-phase, reversible-until-purged flow:
--   1. Soft-delete: set deleted_at + deletion_scheduled_for (= +30d). The org is
--      locked out of the app immediately but ALL data stays intact, so the owner
--      can recover it exactly as-is within the grace window (clears these).
--   2. Hard-delete (cron, Increment B): once deletion_scheduled_for has passed,
--      purge every org-scoped row + storage, then the org itself.
-- Single-org model (launch): an org's members belong only to it, so a purge
-- also cleans up their now-orphaned accounts.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

-- Fast lookup for the hard-delete sweep (only ever a handful of rows).
CREATE INDEX IF NOT EXISTS idx_organizations_deletion_scheduled
  ON organizations (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL;
