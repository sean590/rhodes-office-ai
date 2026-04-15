-- One-off helper: rewrite all references from a directory_entries row to an
-- entities row. Use when you've realized a directory entry should really be
-- a first-class entity (e.g., a person you've now created as a Person entity).
--
-- Usage in the Supabase SQL editor:
--
--   1. Create the new entity via the UI first (so you get all the validation
--      / aliases / ssn_last_4 right). Note its id.
--
--   2. Run this whole file ONCE to install the function:
--
--        \i scripts/migrate-directory-to-entity.sql
--
--      (or paste into the SQL editor and run.)
--
--   3. For each directory entry to migrate, call:
--
--        SELECT migrate_directory_to_entity(
--          '<old-directory-entry-uuid>'::uuid,
--          '<new-entity-uuid>'::uuid,
--          delete_directory_entry := true   -- or false to keep the row
--        );
--
--      The function returns a table with one row per table touched and the
--      number of rows it rewrote, so you can audit what happened.
--
-- What it rewrites (every place a directory FK lives, paired with its entity
-- counterpart so we set one and clear the other):
--
--   entity_managers           directory_entry_id -> ref_entity_id
--   entity_members            directory_entry_id -> ref_entity_id
--   entity_partnership_reps   directory_entry_id -> ref_entity_id   (if table exists)
--   entity_roles              directory_entry_id -> ref_entity_id   (if table exists)
--   trust_roles               directory_entry_id -> ref_entity_id
--   relationships             from_directory_id -> from_entity_id
--   relationships             to_directory_id   -> to_entity_id
--   cap_table_entries         investor_directory_id -> investor_entity_id
--   investment_allocations    member_directory_id   -> member_entity_id
--
-- What it does NOT rewrite (and why):
--
--   investment_co_investors      Directory-only by design. If a co-investor
--                                row should actually be an internal investor,
--                                that's a different concept (investment_investors)
--                                and you should add the entity there manually.
--                                The function will WARN if it finds rows.
--
--   investment_transactions      Has member_directory_id but no entity column —
--                                rewriting would orphan the row. Almost always
--                                created via allocations anyway, so it's safe
--                                to leave existing rows pointing at the old
--                                directory entry; new rows will use the entity.
--                                Function will WARN if it finds rows.
--
-- The function runs in a single transaction. If anything fails, the whole
-- migration rolls back.

CREATE OR REPLACE FUNCTION migrate_directory_to_entity(
  old_directory_id uuid,
  new_entity_id uuid,
  delete_directory_entry boolean DEFAULT false
)
RETURNS TABLE (table_name text, rows_rewritten int)
LANGUAGE plpgsql
AS $$
DECLARE
  cnt int;
  warn_co_investors int;
  warn_transactions int;
BEGIN
  -- Sanity checks.
  IF NOT EXISTS (SELECT 1 FROM directory_entries WHERE id = old_directory_id) THEN
    RAISE EXCEPTION 'directory_entries row % does not exist', old_directory_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM entities WHERE id = new_entity_id) THEN
    RAISE EXCEPTION 'entities row % does not exist', new_entity_id;
  END IF;

  -- entity_managers
  UPDATE entity_managers
     SET ref_entity_id = new_entity_id, directory_entry_id = NULL
   WHERE directory_entry_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'entity_managers'::text, cnt;

  -- entity_members
  UPDATE entity_members
     SET ref_entity_id = new_entity_id, directory_entry_id = NULL
   WHERE directory_entry_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'entity_members'::text, cnt;

  -- entity_partnership_reps (table may not exist on every install — guard).
  IF to_regclass('public.entity_partnership_reps') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE entity_partnership_reps
          SET ref_entity_id = %L, directory_entry_id = NULL
        WHERE directory_entry_id = %L',
      new_entity_id, old_directory_id
    );
    GET DIAGNOSTICS cnt = ROW_COUNT;
    RETURN QUERY SELECT 'entity_partnership_reps'::text, cnt;
  END IF;

  -- entity_roles (same guard — added outside the migrations folder on some
  -- installs, so we probe for it).
  IF to_regclass('public.entity_roles') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE entity_roles
          SET ref_entity_id = %L, directory_entry_id = NULL
        WHERE directory_entry_id = %L',
      new_entity_id, old_directory_id
    );
    GET DIAGNOSTICS cnt = ROW_COUNT;
    RETURN QUERY SELECT 'entity_roles'::text, cnt;
  END IF;

  -- trust_roles
  UPDATE trust_roles
     SET ref_entity_id = new_entity_id, directory_entry_id = NULL
   WHERE directory_entry_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'trust_roles'::text, cnt;

  -- relationships (from_*)
  UPDATE relationships
     SET from_entity_id = new_entity_id, from_directory_id = NULL
   WHERE from_directory_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'relationships.from'::text, cnt;

  -- relationships (to_*)
  UPDATE relationships
     SET to_entity_id = new_entity_id, to_directory_id = NULL
   WHERE to_directory_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'relationships.to'::text, cnt;

  -- cap_table_entries
  UPDATE cap_table_entries
     SET investor_entity_id = new_entity_id, investor_directory_id = NULL
   WHERE investor_directory_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'cap_table_entries'::text, cnt;

  -- investment_allocations
  UPDATE investment_allocations
     SET member_entity_id = new_entity_id, member_directory_id = NULL
   WHERE member_directory_id = old_directory_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN QUERY SELECT 'investment_allocations'::text, cnt;

  -- Warn about tables we deliberately don't touch.
  SELECT count(*)::int INTO warn_co_investors
    FROM investment_co_investors WHERE directory_entry_id = old_directory_id;
  IF warn_co_investors > 0 THEN
    RAISE WARNING 'investment_co_investors has % row(s) referencing this directory entry. Not auto-migrated — co-investors are external by design. If they should be internal investors, add the entity to investment_investors manually.', warn_co_investors;
  END IF;

  SELECT count(*)::int INTO warn_transactions
    FROM investment_transactions WHERE member_directory_id = old_directory_id;
  IF warn_transactions > 0 THEN
    RAISE WARNING 'investment_transactions has % row(s) with member_directory_id pointing at this directory entry (no entity column on that table). Existing rows kept as-is.', warn_transactions;
  END IF;

  -- Optionally delete the directory entry.
  IF delete_directory_entry THEN
    -- Refuse to delete if anything still references it (warns above).
    IF warn_co_investors > 0 OR warn_transactions > 0 THEN
      RAISE EXCEPTION 'Refusing to delete directory_entries row % — still referenced by % co_investor row(s) and % transaction row(s). Re-run with delete_directory_entry := false, or clean those up first.', old_directory_id, warn_co_investors, warn_transactions;
    END IF;
    DELETE FROM directory_entries WHERE id = old_directory_id;
    RETURN QUERY SELECT 'directory_entries (deleted)'::text, 1;
  END IF;
END;
$$;

COMMENT ON FUNCTION migrate_directory_to_entity(uuid, uuid, boolean) IS
  'One-off helper to rewrite all references from a directory_entries row to an entities row. See scripts/migrate-directory-to-entity.sql for usage.';
