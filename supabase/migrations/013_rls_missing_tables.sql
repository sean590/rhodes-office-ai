-- ============================================================================
-- 013: Enable RLS on relationship_documents and user_profiles
--      + clean up duplicate waitlist policy
-- ============================================================================

-- 0. Capture three child tables that were applied by hand in production but
--    never written to a migration (see CLAUDE.md §7). Because they were never
--    in a file, a from-scratch replay — i.e. building the Staging branch —
--    failed here (this migration and 068 both reference them). Create them
--    first so the RLS enable below, and 068's org_isolation policies, have a
--    target.
--
--    DDL mirrors live production exactly (columns/FKs/unique/indexes). IF NOT
--    EXISTS makes it a no-op against prod, which already has them. They live in
--    013 (not a new 002a_*.sql) because Supabase's migration runner only accepts
--    a purely-numeric version prefix — a lettered "002a" file is silently
--    skipped — and there is no free integer slot between 002 and 013.
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

CREATE TABLE IF NOT EXISTS public.relationship_documents (
  relationship_id uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  PRIMARY KEY (relationship_id, document_id)
);

-- 1. relationship_documents — junction table, no RLS at all
ALTER TABLE relationship_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON relationship_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON relationship_documents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON relationship_documents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON relationship_documents
  FOR DELETE TO authenticated USING (true);

-- 2. user_profiles — no RLS at all
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON user_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON user_profiles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON user_profiles
  FOR DELETE TO authenticated USING (true);

-- 3. Clean up duplicate waitlist INSERT policy (added manually outside migrations)
DROP POLICY IF EXISTS "Anyone can join waitlist" ON waitlist;
