-- Migration 049: Three-tier document requirement management.
-- Mirrors compliance migration 048 for document expectations.
-- Tier 1: org-wide document type overrides (org_document_overrides)
-- Tier 2: per-entity-type document profiles (document_profiles)
--
-- Also seeds document_profiles for all existing orgs from ALL_SYSTEM_DEFAULTS
-- and migrates existing document_expectation_templates rows. The old templates
-- table is intentionally left in place — engine rewrite in PR 4.3 stops reading
-- from it but rows remain for rollback safety. A future PR drops the table.

-- 1. Tier 1: Org-level document type overrides
CREATE TABLE org_document_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  document_type TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'disable',
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, document_type)
);

ALTER TABLE org_document_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON org_document_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON org_document_overrides FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON org_document_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON org_document_overrides FOR DELETE TO authenticated USING (true);

-- 2. Tier 2: Per-entity-type document profiles
CREATE TABLE document_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entity_type_scope TEXT NOT NULL,
  document_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_required BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, entity_type_scope, document_type)
);

ALTER TABLE document_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON document_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON document_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON document_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON document_profiles FOR DELETE TO authenticated USING (true);

-- 3. Seed document_profiles for every existing org from ALL_SYSTEM_DEFAULTS.
-- Scope mapping mirrors generateSystemExpectations(): gp → lp, series_llc → llc,
-- grantor_trust | non_grantor_trust → trust. Entity-type-only defaults
-- (investment_fund, real_estate) don't fit the per-legal-structure scope model
-- and are intentionally not seeded — those entities now require explicit
-- custom document requirements per the new model.
WITH seed_data(document_type, is_required, scope) AS (
  VALUES
    -- LLC scope
    ('operating_agreement',           true,  'llc'),
    ('certificate_of_formation',      true,  'llc'),
    ('ein_letter',                    true,  'llc'),
    ('registered_agent_appointment',  true,  'llc'),
    ('certificate_of_good_standing',  false, 'llc'),
    ('federal_tax_return',            false, 'llc'),
    -- Corporation scope
    ('certificate_of_formation',      true,  'corporation'),
    ('articles_of_incorporation',     true,  'corporation'),
    ('bylaws',                        true,  'corporation'),
    ('ein_letter',                    true,  'corporation'),
    ('registered_agent_appointment',  true,  'corporation'),
    ('certificate_of_good_standing',  false, 'corporation'),
    ('federal_tax_return',            false, 'corporation'),
    -- LP scope (also receives entries originally tagged 'gp')
    ('operating_agreement',           true,  'lp'),
    ('certificate_of_formation',      true,  'lp'),
    ('partnership_agreement',         true,  'lp'),
    ('ein_letter',                    true,  'lp'),
    ('registered_agent_appointment',  true,  'lp'),
    ('certificate_of_good_standing',  false, 'lp'),
    ('federal_tax_return',            false, 'lp'),
    -- Trust scope (covers both grantor_trust and non_grantor_trust)
    ('trust_agreement',               true,  'trust'),
    ('ein_letter',                    true,  'trust'),
    ('certificate_of_good_standing',  false, 'trust'),
    ('federal_tax_return',            false, 'trust')
)
INSERT INTO document_profiles (organization_id, entity_type_scope, document_type, is_required)
SELECT o.id, s.scope, s.document_type, s.is_required
FROM organizations o
CROSS JOIN seed_data s
ON CONFLICT (organization_id, entity_type_scope, document_type) DO NOTHING;

-- 4. Migrate existing document_expectation_templates rows.
DO $$
DECLARE
  tpl RECORD;
  scope_value TEXT;
  ls_array JSONB;
  ls_value JSONB;
BEGIN
  FOR tpl IN SELECT * FROM document_expectation_templates LOOP
    IF tpl.source = 'system' THEN
      -- System override row from old PATCH endpoint.
      IF COALESCE((tpl.applies_to_filter ->> 'disabled')::boolean, false) THEN
        -- Disable override → org_document_overrides
        INSERT INTO org_document_overrides (organization_id, document_type, action, reason)
        VALUES (tpl.organization_id, tpl.document_type, 'disable',
                'Migrated from document_expectation_templates')
        ON CONFLICT (organization_id, document_type) DO NOTHING;
      ELSE
        -- is_required override → update seeded profiles for matching scopes
        UPDATE document_profiles
        SET is_required = tpl.is_required, updated_at = now()
        WHERE organization_id = tpl.organization_id
          AND document_type = tpl.document_type;
      END IF;

    ELSIF tpl.source = 'custom' THEN
      -- Custom user template → expand into per-scope document_profiles rows.
      ls_array := COALESCE(tpl.applies_to_filter -> 'legal_structure', '[]'::jsonb);

      IF jsonb_array_length(ls_array) = 0 THEN
        -- No legal_structure filter → applies to all four scopes
        FOREACH scope_value IN ARRAY ARRAY['llc', 'corporation', 'lp', 'trust'] LOOP
          INSERT INTO document_profiles (
            organization_id, entity_type_scope, document_type,
            is_required, enabled, notes
          )
          VALUES (
            tpl.organization_id, scope_value, tpl.document_type,
            tpl.is_required, true, tpl.description
          )
          ON CONFLICT (organization_id, entity_type_scope, document_type)
          DO UPDATE SET
            is_required = EXCLUDED.is_required,
            notes = COALESCE(EXCLUDED.notes, document_profiles.notes),
            updated_at = now();
        END LOOP;
      ELSE
        -- Map each legal_structure value to a scope and insert
        FOR ls_value IN SELECT * FROM jsonb_array_elements(ls_array) LOOP
          scope_value := CASE (ls_value #>> '{}')
            WHEN 'llc'              THEN 'llc'
            WHEN 'series_llc'       THEN 'llc'
            WHEN 'corporation'      THEN 'corporation'
            WHEN 'lp'               THEN 'lp'
            WHEN 'gp'               THEN 'lp'
            WHEN 'grantor_trust'    THEN 'trust'
            WHEN 'non_grantor_trust' THEN 'trust'
            ELSE NULL
          END;

          IF scope_value IS NOT NULL THEN
            INSERT INTO document_profiles (
              organization_id, entity_type_scope, document_type,
              is_required, enabled, notes
            )
            VALUES (
              tpl.organization_id, scope_value, tpl.document_type,
              tpl.is_required, true, tpl.description
            )
            ON CONFLICT (organization_id, entity_type_scope, document_type)
            DO UPDATE SET
              is_required = EXCLUDED.is_required,
              notes = COALESCE(EXCLUDED.notes, document_profiles.notes),
              updated_at = now();
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END $$;
