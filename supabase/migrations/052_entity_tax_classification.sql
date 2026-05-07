-- Migration 052: Add tax_classification to entities.
-- IRS tax election. Drives federal compliance rule matching alongside the
-- existing legal_structure (which drives state rule matching). Nullable
-- because most existing rows won't have it set; the engine skips federal
-- rules whose tax_classifications don't include the entity's value.

ALTER TABLE entities
  ADD COLUMN tax_classification TEXT DEFAULT NULL;

COMMENT ON COLUMN entities.tax_classification IS
  'IRS tax election: partnership, s_corp, c_corp, disregarded, sole_prop, trust_grantor, trust_non_grantor, tax_exempt. NULL = not yet determined. Person entities default to sole_prop in the compliance engine when this column is NULL.';
