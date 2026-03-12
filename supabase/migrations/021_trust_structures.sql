-- 021_trust_structures.sql
-- Add new enum values (must be committed before use)
ALTER TYPE legal_structure ADD VALUE IF NOT EXISTS 'grantor_trust';
ALTER TYPE legal_structure ADD VALUE IF NOT EXISTS 'non_grantor_trust';
