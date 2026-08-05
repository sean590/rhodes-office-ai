-- Inbound failure catalog (2026-08-04): turn per-delivery failures into a
-- cross-org product signal — "which portals do we keep failing on", "how often
-- does OTP relay time out", "what are customers implicitly asking us to build".
--
-- Two PII-free dimensions stamped by the worker at every non-ingest terminal
-- state (see src/lib/inbound/failure-catalog.ts for the taxonomy):
--   failure_code — stable aggregation key (portal_unsupported, safesend_nav_failed, …)
--   failure_host — the portal/secure-delivery domain when known (sharefile.com, …)
-- Neither is personal data, so both SURVIVE the 30-day sender/subject purge and
-- the catalog's trend history is retained forever (Option A).

ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS failure_host TEXT;

-- Aggregation index for the catalog rollup.
CREATE INDEX IF NOT EXISTS idx_inbound_deliveries_failure
  ON inbound_deliveries (failure_code, failure_host)
  WHERE failure_code IS NOT NULL;

-- Cross-org rollup. OPS-ONLY: bypasses per-org RLS (runs with the view owner's
-- privileges), so it is REVOKEd from anon/authenticated and granted to
-- service_role alone — no customer can read another org's failures through it.
-- Purely aggregate + PII-free: month, code, host, counts. For a recent sample
-- subject on a specific host, query the base table directly within the 30-day
-- window (where sender/subject still exist).
CREATE OR REPLACE VIEW inbound_failure_catalog AS
SELECT
  date_trunc('month', received_at)::date       AS month,
  failure_code,
  failure_host,
  classification,
  -- Mirror of DEFICIENCY_CODES in failure-catalog.ts — the failures we could
  -- plausibly remove by building something (vs. environmental/by-design).
  (failure_code IN (
    'portal_unsupported','delivery_unfetched','safesend_nav_failed',
    'safesend_exhausted','attachment_unreadable','handler_exception'
  ))                                            AS is_deficiency,
  count(*)                                      AS occurrences,
  count(DISTINCT organization_id)               AS orgs_affected,
  max(received_at)                              AS last_seen
FROM inbound_deliveries
WHERE failure_code IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;

REVOKE ALL ON inbound_failure_catalog FROM PUBLIC;
REVOKE ALL ON inbound_failure_catalog FROM anon, authenticated;
GRANT SELECT ON inbound_failure_catalog TO service_role;

COMMENT ON VIEW inbound_failure_catalog IS
  'Ops-only cross-org inbound failure rollup (service_role). Deficiency rows = build-signal. See src/lib/inbound/failure-catalog.ts.';
