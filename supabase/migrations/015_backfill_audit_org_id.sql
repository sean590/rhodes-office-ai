-- Backfill organization_id on audit_log rows that are missing it.
-- Derive org from the user's organization_members record.
UPDATE audit_log a
SET organization_id = om.organization_id
FROM organization_members om
WHERE a.organization_id IS NULL
  AND a.user_id = om.user_id;
