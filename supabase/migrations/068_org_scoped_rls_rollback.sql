-- 068_org_scoped_rls_rollback.sql — emergency revert of 068_org_scoped_rls.sql.
-- Restores the prior (permissive) behavior so the app/realtime work as before,
-- and removes the added columns + helper. Run with psql --single-transaction.
-- NOTE: this re-opens tenant isolation at the DB level (back to USING(true)) —
-- only run if 068 broke something and you need the old behavior back fast.

BEGIN;

-- Drop every current policy in public.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Recreate a permissive FOR ALL policy on every RLS table (restores functionality).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Keep the pre-auth waitlist signup working for anon.
CREATE POLICY waitlist_anon_insert ON public.waitlist FOR INSERT TO anon WITH CHECK (true);

-- Remove the helper + the columns this migration added.
DROP FUNCTION IF EXISTS public.user_org_ids();
ALTER TABLE public.document_queue         DROP COLUMN IF EXISTS organization_id;
ALTER TABLE public.compliance_obligations DROP COLUMN IF EXISTS organization_id;

COMMIT;
