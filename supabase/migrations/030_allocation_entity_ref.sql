-- Add member_entity_id to investment_allocations
-- Mirrors cap_table_entries pattern: can reference either a directory_entry or an entity
ALTER TABLE investment_allocations
  ADD COLUMN member_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  ALTER COLUMN member_directory_id DROP NOT NULL;

CREATE INDEX idx_alloc_entity ON investment_allocations(member_entity_id) WHERE member_entity_id IS NOT NULL;
