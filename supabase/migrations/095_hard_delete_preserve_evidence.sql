-- A15: hard_delete_organization must NOT destroy the compliance evidence our
-- policy promises to retain (consent records + audit log, 3+ years). The prior
-- version (090) purged EVERY org-scoped table, including those — deleting the
-- proof of consent and the audit trail along with the org. Fix:
--   1. An org-INDEPENDENT archive (compliance_archive) with NO FK to
--      organizations, so its rows outlive the org row itself.
--   2. hard_delete_organization archives evidence rows BEFORE the purge, then
--      EXCLUDES the evidence tables (and the archive) from the delete loop.
--
-- Defensive: evidence tables are archived only when they exist (to_regclass), so
-- this is correct on prod now (consent_records ships with the un-promoted billing
-- stack) and starts archiving consent automatically once that lands.
--
-- NOTE: a separate job should purge compliance_archive after the retention
-- window (3y) — deliberately out of scope here; preservation first.

CREATE TABLE IF NOT EXISTS compliance_archive (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT NOT NULL,
  -- The org the row belonged to, kept as a plain value. NO foreign key — the
  -- whole point is that this survives the organizations row being deleted.
  organization_id UUID,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_archive_org ON compliance_archive (organization_id, source_table);

-- Ops-only evidence store. service_role (the offboarding cron) reads/writes;
-- no customer-facing access.
ALTER TABLE compliance_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON compliance_archive FROM anon, authenticated;
GRANT ALL ON compliance_archive TO service_role;

CREATE OR REPLACE FUNCTION hard_delete_organization(p_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  n BIGINT;
  total BIGINT := 0;
  counts JSONB := '{}'::JSONB;
  archived JSONB := '{}'::JSONB;
  -- Evidence to PRESERVE (archive + skip). compliance_archive is here so the
  -- generic loop below never deletes the rows we just archived (it too carries
  -- an organization_id column).
  evidence TEXT[] := ARRAY['consent_records', 'audit_log', 'compliance_archive'];
  ev TEXT;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'p_org is required'; END IF;

  -- Order-independent deletes: turn off FK enforcement for this txn only.
  SET LOCAL session_replication_role = replica;

  -- (0) Preserve compliance evidence BEFORE anything is deleted. Copy each
  -- existing evidence table's org rows into the org-independent archive.
  FOREACH ev IN ARRAY ARRAY['consent_records', 'audit_log'] LOOP
    IF to_regclass('public.' || ev) IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO compliance_archive (source_table, organization_id, row_data)
           SELECT %L, $1, to_jsonb(x) FROM public.%I x WHERE x.organization_id = $1',
        ev, ev
      ) USING p_org;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN archived := archived || jsonb_build_object(ev, n); END IF;
    END IF;
  END LOOP;

  -- Snapshot org-scoped parent id sets BEFORE deleting the parents, so the
  -- transitive deletes below can still find their rows.
  CREATE TEMP TABLE _ents ON COMMIT DROP AS SELECT id FROM entities WHERE organization_id = p_org;
  CREATE TEMP TABLE _dirs ON COMMIT DROP AS SELECT id FROM directory_entries WHERE organization_id = p_org;
  CREATE TEMP TABLE _docs ON COMMIT DROP AS SELECT id FROM documents WHERE organization_id = p_org;
  CREATE TEMP TABLE _sess ON COMMIT DROP AS SELECT id FROM chat_sessions WHERE organization_id = p_org;
  CREATE TEMP TABLE _obl  ON COMMIT DROP AS SELECT id FROM compliance_obligations WHERE organization_id = p_org;
  CREATE TEMP TABLE _rel  ON COMMIT DROP AS SELECT id FROM relationships WHERE organization_id = p_org;
  CREATE TEMP TABLE _cfd  ON COMMIT DROP AS SELECT id FROM custom_field_definitions WHERE organization_id = p_org;

  -- (1) Transitive tables — scoped through parents, using each table's actual FK
  -- columns (delete if ANY points into the org: cross-org rows shouldn't exist,
  -- but this guarantees no orphan whichever column "owns" the row).
  DELETE FROM cap_table_entries WHERE entity_id IN (SELECT id FROM _ents) OR investor_entity_id IN (SELECT id FROM _ents) OR investor_directory_id IN (SELECT id FROM _dirs);
  DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM _sess);
  DELETE FROM compliance_obligation_cycles WHERE obligation_id IN (SELECT id FROM _obl) OR document_id IN (SELECT id FROM _docs);
  DELETE FROM custom_field_values WHERE entity_id IN (SELECT id FROM _ents) OR field_def_id IN (SELECT id FROM _cfd);
  DELETE FROM entity_filings WHERE entity_id IN (SELECT id FROM _ents);
  DELETE FROM entity_managers WHERE entity_id IN (SELECT id FROM _ents) OR ref_entity_id IN (SELECT id FROM _ents) OR directory_entry_id IN (SELECT id FROM _dirs);
  DELETE FROM entity_members WHERE entity_id IN (SELECT id FROM _ents) OR ref_entity_id IN (SELECT id FROM _ents) OR directory_entry_id IN (SELECT id FROM _dirs);
  DELETE FROM entity_partnership_reps WHERE entity_id IN (SELECT id FROM _ents) OR ref_entity_id IN (SELECT id FROM _ents) OR directory_entry_id IN (SELECT id FROM _dirs);
  DELETE FROM entity_registrations WHERE entity_id IN (SELECT id FROM _ents);
  DELETE FROM entity_roles WHERE entity_id IN (SELECT id FROM _ents) OR ref_entity_id IN (SELECT id FROM _ents) OR directory_entry_id IN (SELECT id FROM _dirs);
  DELETE FROM entity_state_ids WHERE entity_id IN (SELECT id FROM _ents);
  DELETE FROM joint_title_members WHERE person_entity_id IN (SELECT id FROM _ents) OR joint_title_id IN (SELECT id FROM _ents);
  DELETE FROM person_relationships WHERE from_person_id IN (SELECT id FROM _ents) OR to_person_id IN (SELECT id FROM _ents);
  DELETE FROM relationship_documents WHERE relationship_id IN (SELECT id FROM _rel) OR document_id IN (SELECT id FROM _docs);
  DELETE FROM trust_details WHERE entity_id IN (SELECT id FROM _ents);
  DELETE FROM trust_roles WHERE ref_entity_id IN (SELECT id FROM _ents) OR directory_entry_id IN (SELECT id FROM _dirs);

  -- (2) Direct tables — every table with an organization_id column, EXCEPT the
  -- preserved evidence + the archive itself.
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
      AND table_name <> ALL (evidence)
    ORDER BY table_name
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1', t) USING p_org;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      total := total + n;
      counts := counts || jsonb_build_object(t, n);
    END IF;
  END LOOP;

  -- user_profiles is NOT org-owned (one profile per user); just clear dangling
  -- references so nothing points at deleted rows. The member auth accounts (and
  -- thus their profiles) are deleted by the caller.
  UPDATE user_profiles SET active_organization_id = NULL WHERE active_organization_id = p_org;
  UPDATE user_profiles SET primary_entity_id = NULL WHERE primary_entity_id IN (SELECT id FROM _ents);

  DELETE FROM organizations WHERE id = p_org;

  RETURN jsonb_build_object('org', p_org, 'direct_rows_deleted', total, 'by_table', counts, 'archived', archived);
END;
$$;

REVOKE ALL ON FUNCTION hard_delete_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hard_delete_organization(UUID) TO service_role;
