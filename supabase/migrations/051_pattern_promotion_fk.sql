-- Migration 051: Repurpose org_document_patterns.promoted_to_template_id.
-- PR 6.1 rewires the "promote pattern" flow to write document_profiles rows
-- instead of document_expectation_templates rows. The column still acts as a
-- boolean-ish signal ("has this pattern been promoted?"), but now points at a
-- profile row UUID. Drop the FK to document_expectation_templates so the new
-- value is accepted. The column name is kept for compatibility (UI reads it
-- as !!promoted_to_template_id).

ALTER TABLE org_document_patterns
  DROP CONSTRAINT IF EXISTS org_document_patterns_promoted_to_template_id_fkey;
