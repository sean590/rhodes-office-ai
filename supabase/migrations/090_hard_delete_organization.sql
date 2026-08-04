-- Increment B: complete hard-delete of an organization's data (offboarding).
--
-- Called by the cron once an org is past its 30-day grace. Purges EVERY
-- org-scoped row across the schema. Storage files and member auth accounts are
-- handled by the caller (app cron) around this — this function owns the public
-- schema teardown + the org row.
--
-- Strategy: disable FK triggers for the transaction (session_replication_role =
-- replica) so we can delete in any order despite self-references (documents ->
-- documents, entities -> entities, ...) and mixed CASCADE/SET NULL/NO ACTION
-- rules. SECURITY DEFINER so the app's service role can invoke it via RPC; the
-- owner (postgres) can toggle session_replication_role.
--
-- Completeness has two tiers:
--   1. Transitive tables (no organization_id of their own — e.g. entity_members,
--      chat_messages) are deleted FIRST, scoped through their org-scoped parents
--      (whose ids we snapshot before deleting the parents).
--   2. Direct tables (every table WITH an organization_id column) are deleted
--      generically from information_schema — so a newly-added org-scoped table
--      is covered automatically.

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
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'p_org is required'; END IF;

  -- Order-independent deletes: turn off FK enforcement for this txn only.
  SET LOCAL session_replication_role = replica;

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

  -- (2) Direct tables — every table with an organization_id column.
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
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

  RETURN jsonb_build_object('org', p_org, 'direct_rows_deleted', total, 'by_table', counts);
END;
$$;

REVOKE ALL ON FUNCTION hard_delete_organization(UUID) FROM PUBLIC;
-- Only the service role (the offboarding cron) may invoke it.
GRANT EXECUTE ON FUNCTION hard_delete_organization(UUID) TO service_role;
