-- Apply-for-beta form columns + A/B variant attribution
-- Run BEFORE deploying index-apply.html (the insert references these columns).
-- Safe on prod: additive only, IF NOT EXISTS, no data touched.
-- Follows the same pattern as 071_waitlist_attribution.sql.

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS entity_count    TEXT,
  ADD COLUMN IF NOT EXISTS asset_mix       TEXT,
  ADD COLUMN IF NOT EXISTS tracking_method TEXT,
  ADD COLUMN IF NOT EXISTS landing_variant TEXT;

COMMENT ON COLUMN waitlist.entity_count    IS 'Bracket from the apply form: 1-2 | 3-4 | 5-9 | 10-24 | 25+';
COMMENT ON COLUMN waitlist.asset_mix       IS 'Comma-joined: llcs,trusts,lp_stakes,operating_businesses,other';
COMMENT ON COLUMN waitlist.tracking_method IS 'spreadsheet | drive_email | software | someone_else';
COMMENT ON COLUMN waitlist.landing_variant IS 'A/B hero variant that converted this signup: a | b (null = pre-test signup)';

-- Qualified-applicant view for the weekly review and the 8/10 readout.
-- Triage rule (must match supabase/functions/waitlist-welcome/index.ts):
-- 5+ entities OR any trust OR (LP stakes AND 3+ entities).
CREATE OR REPLACE VIEW waitlist_qualified AS
SELECT *,
  (
    entity_count IN ('5-9', '10-24', '25+')
    OR asset_mix LIKE '%trusts%'
    OR (asset_mix LIKE '%lp_stakes%' AND entity_count IN ('3-4', '5-9', '10-24', '25+'))
  ) AS qualified
FROM waitlist
WHERE entity_count IS NOT NULL;
