-- 022_backfill_trust_structures.sql
-- Backfill existing trust entities to grantor_trust (requires enum values from 021 to be committed)
UPDATE entities SET legal_structure = 'grantor_trust' WHERE legal_structure = 'trust';
UPDATE entities SET legal_structure = 'grantor_trust' WHERE type = 'trust' AND legal_structure IS NULL;
