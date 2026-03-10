-- ============================================================================
-- 020: Document Completeness Tracking
-- Tables for document expectation templates, per-entity expectations, and
-- org-level inferred patterns.
-- ============================================================================

-- 1. Org-wide custom document templates
-- Defines rules for what documents entities should have.
CREATE TABLE IF NOT EXISTS document_expectation_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_category TEXT NOT NULL,
  is_required BOOLEAN DEFAULT true,
  description TEXT,
  applies_to_filter JSONB DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'custom',  -- 'system' or 'custom'
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, document_type)
);

CREATE INDEX idx_doc_exp_templates_org ON document_expectation_templates(organization_id);

-- 2. Per-entity expectations (the actual checklist rows)
CREATE TABLE IF NOT EXISTS entity_document_expectations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id UUID REFERENCES document_expectation_templates(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  document_category TEXT NOT NULL,
  is_required BOOLEAN DEFAULT true,
  is_satisfied BOOLEAN DEFAULT false,
  satisfied_by UUID REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'system',  -- 'system', 'template', 'manual', 'inferred'
  confidence FLOAT,
  inference_reason TEXT,
  is_suggestion BOOLEAN DEFAULT false,
  notes TEXT,
  is_not_applicable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, document_type)
);

CREATE INDEX idx_entity_doc_exp_entity ON entity_document_expectations(entity_id);
CREATE INDEX idx_entity_doc_exp_org ON entity_document_expectations(organization_id);
CREATE INDEX idx_entity_doc_exp_satisfied ON entity_document_expectations(entity_id, is_satisfied);

-- 3. Org-level inferred patterns (for Feature 5, created now for schema completeness)
CREATE TABLE IF NOT EXISTS org_document_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_category TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  confidence FLOAT NOT NULL DEFAULT 0,
  entity_coverage FLOAT,
  times_confirmed INTEGER DEFAULT 0,
  times_dismissed INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  promoted_to_template_id UUID REFERENCES document_expectation_templates(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, pattern_type, document_type)
);

CREATE INDEX idx_org_doc_patterns_org ON org_document_patterns(organization_id);

-- 4. Enable RLS (permissive for now, matching existing pattern)
ALTER TABLE document_expectation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_document_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_document_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON document_expectation_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_full_access" ON entity_document_expectations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_full_access" ON org_document_patterns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
