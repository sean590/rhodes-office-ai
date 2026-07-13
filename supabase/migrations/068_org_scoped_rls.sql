-- 068_org_scoped_rls.sql — Phase 1 tenant isolation.
-- Replaces the permissive `USING (true)` RLS (any authenticated user could read/
-- write every org's rows via the anon client / realtime) with org-scoped policies.
-- Defense-in-depth: the app's service-role client bypasses RLS, so this does NOT
-- replace requireOrg() — it closes the raw-anon-client + realtime hole.
-- Designed against the LIVE schema (migrations had drifted). Rollback: 068_..._rollback.sql.
-- Apply in a single transaction (psql --single-transaction): all-or-nothing.

BEGIN;

-- 0. Membership helper. SECURITY DEFINER so it bypasses RLS on organization_members
--    (avoids policy recursion) and is evaluated once per query (STABLE).
CREATE OR REPLACE FUNCTION public.user_org_ids()
  RETURNS setof uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
$fn$;
REVOKE ALL ON FUNCTION public.user_org_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.user_org_ids() TO authenticated;

-- 1. Schema: add organization_id where the join path is unreliable, then backfill.
ALTER TABLE public.document_queue          ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.compliance_obligations  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

UPDATE public.document_queue q
   SET organization_id = b.organization_id
  FROM public.document_batches b
 WHERE q.batch_id = b.id AND q.organization_id IS NULL;

UPDATE public.compliance_obligations o
   SET organization_id = e.organization_id
  FROM public.entities e
 WHERE o.entity_id = e.id AND o.organization_id IS NULL;

-- Enforce NOT NULL only if the backfill was complete (else leave nullable + notice).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.document_queue WHERE organization_id IS NULL) THEN
    ALTER TABLE public.document_queue ALTER COLUMN organization_id SET NOT NULL;
  ELSE RAISE NOTICE 'document_queue: NULL organization_id rows remain — left nullable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.compliance_obligations WHERE organization_id IS NULL) THEN
    ALTER TABLE public.compliance_obligations ALTER COLUMN organization_id SET NOT NULL;
  ELSE RAISE NOTICE 'compliance_obligations: NULL organization_id rows remain — left nullable'; END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_queue_org         ON public.document_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_compliance_obligations_org ON public.compliance_obligations(organization_id);

-- 2. Clean slate: drop EVERY existing policy in public (they were USING(true)).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 3. DIRECT tables (have organization_id): one FOR ALL org-isolation policy each.
DO $$
DECLARE t text;
  direct text[] := ARRAY[
    'documents','entities','directory_entries','relationships','chat_sessions','chat_feedback','chat_tool_calls',
    'custom_field_definitions','compliance_profiles','org_compliance_overrides','org_document_overrides',
    'document_profiles','document_entity_links','document_expectation_templates','entity_document_expectations',
    'org_document_patterns','org_provider_routing_rules','document_batches','document_queue','compliance_obligations',
    'investments','investment_allocations','investment_transactions','investment_co_investors','investment_investors',
    'service_providers','service_provider_entities','provider_document_sends','provider_document_send_access',
    'provider_document_send_documents','provider_send_dismissals','organization_invites'
  ];
BEGIN
  FOREACH t IN ARRAY direct LOOP
    EXECUTE format($f$
      CREATE POLICY org_isolation ON public.%1$I FOR ALL TO authenticated
        USING (organization_id IN (SELECT public.user_org_ids()))
        WITH CHECK (organization_id IN (SELECT public.user_org_ids()))
    $f$, t);
  END LOOP;
END $$;

-- 4. CHILD via entity_id -> entities.organization_id.
DO $$
DECLARE t text;
  child_entity text[] := ARRAY[
    'cap_table_entries','custom_field_values','entity_filings','entity_managers','entity_members',
    'entity_partnership_reps','entity_registrations','entity_roles','entity_state_ids','trust_details'
  ];
BEGIN
  FOREACH t IN ARRAY child_entity LOOP
    EXECUTE format($f$
      CREATE POLICY org_isolation ON public.%1$I FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = %1$I.entity_id
                       AND e.organization_id IN (SELECT public.user_org_ids())))
        WITH CHECK (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = %1$I.entity_id
                       AND e.organization_id IN (SELECT public.user_org_ids())))
    $f$, t);
  END LOOP;
END $$;

-- 5. Special child tables (non-entity_id join paths).
CREATE POLICY org_isolation ON public.chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = chat_messages.session_id AND s.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = chat_messages.session_id AND s.organization_id IN (SELECT public.user_org_ids())));

CREATE POLICY org_isolation ON public.trust_roles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trust_details td JOIN public.entities e ON e.id = td.entity_id WHERE td.id = trust_roles.trust_detail_id AND e.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trust_details td JOIN public.entities e ON e.id = td.entity_id WHERE td.id = trust_roles.trust_detail_id AND e.organization_id IN (SELECT public.user_org_ids())));

CREATE POLICY org_isolation ON public.compliance_obligation_cycles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.compliance_obligations o WHERE o.id = compliance_obligation_cycles.obligation_id AND o.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.compliance_obligations o WHERE o.id = compliance_obligation_cycles.obligation_id AND o.organization_id IN (SELECT public.user_org_ids())));

CREATE POLICY org_isolation ON public.relationship_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.relationships r WHERE r.id = relationship_documents.relationship_id AND r.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.relationships r WHERE r.id = relationship_documents.relationship_id AND r.organization_id IN (SELECT public.user_org_ids())));

CREATE POLICY org_isolation ON public.joint_title_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = joint_title_members.joint_title_id AND e.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = joint_title_members.joint_title_id AND e.organization_id IN (SELECT public.user_org_ids())));

CREATE POLICY org_isolation ON public.person_relationships FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = person_relationships.from_person_id AND e.organization_id IN (SELECT public.user_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = person_relationships.from_person_id AND e.organization_id IN (SELECT public.user_org_ids())));

-- 6. USER-SCOPED: own row + co-members may read; writes self only.
CREATE POLICY self_or_org_read ON public.user_profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR id IN (SELECT om.user_id FROM public.organization_members om WHERE om.organization_id IN (SELECT public.user_org_ids())));
CREATE POLICY self_insert ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY self_update ON public.user_profiles FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY self_delete ON public.user_profiles FOR DELETE TO authenticated USING (id = (SELECT auth.uid()));

CREATE POLICY self_or_org_read ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR id IN (SELECT om.user_id FROM public.organization_members om WHERE om.organization_id IN (SELECT public.user_org_ids())));
CREATE POLICY self_insert ON public.users FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY self_update ON public.users FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- 7. PUBLIC / REFERENCE / SPECIAL.
-- Reference filing rules: readable by any authenticated user; writes via service-role only.
CREATE POLICY ref_read ON public.state_filing_requirements FOR SELECT TO authenticated USING (true);

-- Document types: org rows + global (null-org) rows readable; writes org-scoped.
CREATE POLICY org_or_global_read ON public.document_types FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY org_insert ON public.document_types FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY org_update ON public.document_types FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.user_org_ids())) WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
CREATE POLICY org_delete ON public.document_types FOR DELETE TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- Waitlist: pre-auth signup — anon (and authenticated) may INSERT; no one reads it via the client.
CREATE POLICY waitlist_insert_anon ON public.waitlist FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY waitlist_insert_auth ON public.waitlist FOR INSERT TO authenticated WITH CHECK (true);

-- Organizations: members read/update their orgs; any authed user may create (onboarding).
CREATE POLICY org_member_read   ON public.organizations FOR SELECT TO authenticated USING (id IN (SELECT public.user_org_ids()));
CREATE POLICY org_create        ON public.organizations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY org_member_update ON public.organizations FOR UPDATE TO authenticated USING (id IN (SELECT public.user_org_ids())) WITH CHECK (id IN (SELECT public.user_org_ids()));

-- Organization members: members read co-members; writes via service-role (Phase 2 RBAC adds admin writes).
CREATE POLICY member_read ON public.organization_members FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

-- Audit log: org-scoped READ only; NO user writes -> append-only, untamperable by end users.
CREATE POLICY audit_read ON public.audit_log FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids()));

COMMIT;
