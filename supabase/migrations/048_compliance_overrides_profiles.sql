-- Migration 048: Three-tier compliance management tables.
-- Tier 1: org-level rule overrides (disable a rule org-wide)
-- Tier 2: entity-type compliance profiles (disable a rule per entity type)

-- 1. Org-level compliance rule overrides
CREATE TABLE org_compliance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  rule_id TEXT,
  obligation_type TEXT,
  jurisdiction TEXT,
  action TEXT NOT NULL DEFAULT 'disable',
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX org_compliance_overrides_unique
  ON org_compliance_overrides(organization_id, COALESCE(rule_id, ''), COALESCE(obligation_type, ''), COALESCE(jurisdiction, ''));

ALTER TABLE org_compliance_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON org_compliance_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON org_compliance_overrides FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON org_compliance_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON org_compliance_overrides FOR DELETE TO authenticated USING (true);

-- 2. Entity-type compliance profiles
CREATE TABLE compliance_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entity_type_scope TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, entity_type_scope, rule_id)
);

ALTER TABLE compliance_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON compliance_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON compliance_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON compliance_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON compliance_profiles FOR DELETE TO authenticated USING (true);
