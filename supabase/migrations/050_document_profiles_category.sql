-- Migration 050: Add document_category to document_profiles.
-- Migration 049 created profiles without a category, but
-- entity_document_expectations needs document_category at engine write time.
-- This migration adds the column, backfills it from ALL_SYSTEM_DEFAULTS for
-- seeded rows and from the original document_expectation_templates for any
-- rows that were migrated from custom user templates, then makes it NOT NULL.

ALTER TABLE document_profiles ADD COLUMN document_category TEXT;

-- Backfill from ALL_SYSTEM_DEFAULTS-equivalent values.
-- Categories below match the document_category field of each entry in
-- ALL_SYSTEM_DEFAULTS (lib/utils/document-expectations.ts).
UPDATE document_profiles SET document_category = 'formation' WHERE document_type IN (
  'operating_agreement', 'certificate_of_formation', 'trust_agreement',
  'articles_of_incorporation', 'partnership_agreement'
);
UPDATE document_profiles SET document_category = 'tax' WHERE document_type IN (
  'ein_letter', 'federal_tax_return'
);
UPDATE document_profiles SET document_category = 'compliance' WHERE document_type IN (
  'registered_agent_appointment', 'certificate_of_good_standing'
);
UPDATE document_profiles SET document_category = 'governance' WHERE document_type IN (
  'bylaws'
);

-- Backfill remaining (migrated custom rows) from the original templates table.
-- Use MIN to deterministically pick one row when the same (org, doc_type) appears
-- in templates more than once — the unique constraint should prevent that, but
-- MIN is safe regardless.
UPDATE document_profiles dp
SET document_category = (
  SELECT MIN(t.document_category)
  FROM document_expectation_templates t
  WHERE t.organization_id = dp.organization_id
    AND t.document_type = dp.document_type
    AND t.document_category IS NOT NULL
)
WHERE dp.document_category IS NULL;

-- Anything still NULL falls back to 'other'.
UPDATE document_profiles SET document_category = 'other' WHERE document_category IS NULL;

ALTER TABLE document_profiles
  ALTER COLUMN document_category SET NOT NULL,
  ALTER COLUMN document_category SET DEFAULT 'other';
