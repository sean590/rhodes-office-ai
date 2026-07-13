-- Migration 037: Person and Joint-Title entity types
--
-- Adds `person` and `joint_title` to the entity_type enum, adds ssn_last_4
-- to entities, makes formation_state nullable (persons use it as
-- residence_state; joint_title entities don't carry one), creates the
-- joint_title_members side table, and creates person_relationships for
-- family edges (spouse_of, parent_of, child_of).

-- Extend entity_type enum.
ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'person';
ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'joint_title';

-- SSN last 4 for disambiguating identically-named persons. Only the last 4.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS ssn_last_4 VARCHAR(4);

-- formation_state is required for LLCs/trusts but not for persons or
-- joint_title entities. For persons, the same column is surfaced in the UI
-- as "Residence State" (drives state tax filings).
ALTER TABLE entities ALTER COLUMN formation_state DROP NOT NULL;

-- Joint-title members: which persons compose a joint_title entity.
CREATE TABLE IF NOT EXISTS joint_title_members (
  joint_title_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  person_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  ownership_form   TEXT NOT NULL CHECK (ownership_form IN ('jtwros','tbe','tic','community_property','other')),
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (joint_title_id, person_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_joint_title_members_joint ON joint_title_members(joint_title_id);
CREATE INDEX IF NOT EXISTS idx_joint_title_members_person ON joint_title_members(person_entity_id);

-- Person-to-person family relationships. Kept separate from the existing
-- `relationships` table because that table models business/legal
-- relationships with payment frequency, amounts, and status semantics that
-- don't apply to family edges.
CREATE TABLE IF NOT EXISTS person_relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_person_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship     TEXT NOT NULL CHECK (relationship IN ('spouse_of','parent_of','child_of')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (from_person_id, to_person_id, relationship),
  CONSTRAINT chk_distinct_persons CHECK (from_person_id <> to_person_id)
);
CREATE INDEX IF NOT EXISTS idx_person_rel_from ON person_relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_person_rel_to ON person_relationships(to_person_id);
