-- rls_isolation_test.sql — cross-tenant RLS isolation harness (Phase 1 CI gate).
-- Seeds TWO synthetic orgs + members + representative rows (one per RLS pattern),
-- then asserts a member of org A cannot SEE or WRITE org B's data — and a
-- non-member sees nothing. Any leak RAISEs an exception → psql (-v ON_ERROR_STOP=1)
-- exits non-zero → CI fails. The whole thing runs in a transaction and ROLLS BACK,
-- so it leaves no data — safe to run against any DB (live/staging/local).
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
--   (or: npm run test:rls)

\set ON_ERROR_STOP on
BEGIN;

-- Fixed fixture UUIDs.
\set org_a   '11111111-1111-1111-1111-111111111111'
\set org_b   '22222222-2222-2222-2222-222222222222'
\set user_a  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set user_b  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set ent_a   'a1a1a1a1-0000-0000-0000-000000000001'
\set ent_b   'b2b2b2b2-0000-0000-0000-000000000002'
\set nobody  '00000000-0000-0000-0000-000000000000'

-- ---- SEED (FK/trigger enforcement off so we needn't touch auth.users etc.) ----
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name) VALUES (:'org_a','RLS Test A'), (:'org_b','RLS Test B');
INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (:'org_a', :'user_a', 'owner'), (:'org_b', :'user_b', 'owner');
INSERT INTO public.user_profiles (id) VALUES (:'user_a'), (:'user_b');
INSERT INTO public.entities (id, name, type, organization_id)
  VALUES (:'ent_a','Ent A','holding_company',:'org_a'), (:'ent_b','Ent B','holding_company',:'org_b');
INSERT INTO public.documents (id, name, document_type, file_path, organization_id)
  VALUES (gen_random_uuid(),'Doc A','other', :'org_a'||'/a.pdf', :'org_a'),
         (gen_random_uuid(),'Doc B','other', :'org_b'||'/b.pdf', :'org_b');
INSERT INTO public.entity_state_ids (entity_id, jurisdiction, state_id_number)
  VALUES (:'ent_a','AL','A-1'), (:'ent_b','AL','B-1');
INSERT INTO public.audit_log (action, organization_id)
  VALUES ('rls_test', :'org_a'), ('rls_test', :'org_b');

SET LOCAL session_replication_role = origin;   -- restore; RLS applies under SET ROLE below

-- ---- AS USER A (member of org A only) ----
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_a')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE n int;
BEGIN
  -- helper sees only org A
  IF EXISTS (SELECT 1 FROM public.user_org_ids() x WHERE x = '22222222-2222-2222-2222-222222222222')
     THEN RAISE EXCEPTION 'FAIL: user_org_ids() leaked org B to user A'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_org_ids() x WHERE x = '11111111-1111-1111-1111-111111111111')
     THEN RAISE EXCEPTION 'FAIL: user_org_ids() missing user A''s own org'; END IF;

  -- DIRECT: entities / documents — sees own org's rows, NONE of org B's
  SELECT count(*) INTO n FROM public.entities;       IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % entities (want 1)', n; END IF;
  SELECT count(*) INTO n FROM public.documents;      IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % documents (want 1)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.entities  WHERE organization_id='22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'FAIL: A can see org B entities'; END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE organization_id='22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'FAIL: A can see org B documents'; END IF;

  -- CHILD: entity_state_ids (via entity) — only org A's
  SELECT count(*) INTO n FROM public.entity_state_ids; IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % entity_state_ids (want 1)', n; END IF;

  -- USER-SCOPED: user_profiles — sees own only (user B is not a co-member)
  SELECT count(*) INTO n FROM public.user_profiles; IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % user_profiles (want 1: self)', n; END IF;

  -- audit_log — org-scoped read, only org A's
  SELECT count(*) INTO n FROM public.audit_log WHERE action='rls_test'; IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % audit rows (want 1)', n; END IF;

  RAISE NOTICE 'PASS: user A reads are org-isolated';
END $$;

-- cross-tenant WRITES must be denied
DO $$
DECLARE wrote boolean := false; affected int;
BEGIN
  -- INSERT a document into org B → WITH CHECK must block it
  BEGIN
    INSERT INTO public.documents (id, name, document_type, file_path, organization_id)
      VALUES (gen_random_uuid(),'evil','other','x/x.pdf','22222222-2222-2222-2222-222222222222');
    wrote := true;
  EXCEPTION WHEN insufficient_privilege THEN wrote := false; END;
  IF wrote THEN RAISE EXCEPTION 'FAIL: A inserted a document into org B'; END IF;

  -- UPDATE: reassign A''s own doc into org B → WITH CHECK must block it
  wrote := false;
  BEGIN
    UPDATE public.documents SET organization_id='22222222-2222-2222-2222-222222222222'
      WHERE organization_id='11111111-1111-1111-1111-111111111111';
    wrote := true;
  EXCEPTION WHEN insufficient_privilege THEN wrote := false; END;
  IF wrote THEN RAISE EXCEPTION 'FAIL: A moved a document into org B via UPDATE'; END IF;

  -- DELETE org B''s docs → invisible, so 0 rows affected (cannot reach them)
  DELETE FROM public.documents WHERE organization_id='22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'FAIL: A deleted % of org B''s documents', affected; END IF;

  RAISE NOTICE 'PASS: user A cross-tenant writes are denied';
END $$;

RESET ROLE;

-- ---- AS USER B (member of org B only) — symmetric check ----
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_b')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.entities;  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: B sees % entities (want 1)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE organization_id='11111111-1111-1111-1111-111111111111') THEN RAISE EXCEPTION 'FAIL: B can see org A documents'; END IF;
  RAISE NOTICE 'PASS: user B reads are org-isolated';
END $$;
RESET ROLE;

-- ---- AS A NON-MEMBER (uid in no org) — must see nothing ----
SELECT set_config('request.jwt.claims', json_build_object('sub', :'nobody')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.documents; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: non-member sees % documents (want 0)', n; END IF;
  SELECT count(*) INTO n FROM public.entities;  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: non-member sees % entities (want 0)', n; END IF;
  SELECT count(*) INTO n FROM public.audit_log WHERE action='rls_test'; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: non-member sees % audit rows (want 0)', n; END IF;
  RAISE NOTICE 'PASS: non-member sees nothing';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE '== ALL RLS ISOLATION TESTS PASSED =='; END $$;

ROLLBACK;
