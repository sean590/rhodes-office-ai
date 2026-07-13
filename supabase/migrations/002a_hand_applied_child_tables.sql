-- ============================================================================
-- 002a: Capture three child tables that were applied by hand in production but
--       never written to a migration file.
--
-- WHY THIS EXISTS: production was built partly via the Supabase SQL editor
-- (see CLAUDE.md §7). These three tables (peers of the entity child/junction
-- tables in 002_tables.sql) were created by hand and never captured, so a
-- from-scratch replay — i.e. building the Staging branch — failed: migration
-- 013 does `ALTER TABLE relationship_documents ENABLE RLS` and 068 creates
-- org_isolation policies on all three, both of which error with "relation does
-- not exist". Creating them here (after their FK targets in 002, before their
-- first reference in 013) makes the migration set replay cleanly.
--
-- DDL mirrors the live production schema exactly (columns, FKs, unique keys,
-- indexes). IF NOT EXISTS guards make this safe if a target DB already has them
-- (e.g. production, where they already exist).
-- ============================================================================

-- Entity role assignments (e.g. "Manager: Jane Doe"). Child of entities.
CREATE TABLE IF NOT EXISTS public.entity_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  role_title text NOT NULL,
  name text NOT NULL,
  directory_entry_id uuid REFERENCES public.directory_entries(id),
  ref_entity_id uuid REFERENCES public.entities(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, role_title, name)
);
CREATE INDEX IF NOT EXISTS idx_entity_roles_entity ON public.entity_roles USING btree (entity_id);
ALTER TABLE public.entity_roles ENABLE ROW LEVEL SECURITY;

-- Partnership representatives. Child of entities.
CREATE TABLE IF NOT EXISTS public.entity_partnership_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  directory_entry_id uuid REFERENCES public.directory_entries(id),
  ref_entity_id uuid REFERENCES public.entities(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, name)
);
CREATE INDEX IF NOT EXISTS idx_partnership_reps_entity ON public.entity_partnership_reps USING btree (entity_id);
ALTER TABLE public.entity_partnership_reps ENABLE ROW LEVEL SECURITY;

-- Junction: documents attached to a relationship. Composite PK, no own id.
CREATE TABLE IF NOT EXISTS public.relationship_documents (
  relationship_id uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  PRIMARY KEY (relationship_id, document_id)
);
-- RLS is also enabled by 013 (idempotent); enabling here keeps this table's
-- security posture correct from creation.
ALTER TABLE public.relationship_documents ENABLE ROW LEVEL SECURITY;
