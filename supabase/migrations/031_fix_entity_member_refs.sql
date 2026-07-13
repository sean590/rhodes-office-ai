-- Fix entity_members rows that have no ref_entity_id but match an entity by name

-- Exact name match
UPDATE entity_members
SET ref_entity_id = match.id
FROM entities match, entities parent
WHERE entity_members.ref_entity_id IS NULL
  AND entity_members.directory_entry_id IS NULL
  AND parent.id = entity_members.entity_id
  AND match.organization_id = parent.organization_id
  AND match.id != entity_members.entity_id
  AND lower(trim(entity_members.name)) = lower(trim(match.name));

-- Contains match for partial names (e.g., "Glen Una Drive 2022" -> "Glen Una Drive 2022 Trust")
UPDATE entity_members
SET ref_entity_id = match.id
FROM entities match, entities parent
WHERE entity_members.ref_entity_id IS NULL
  AND entity_members.directory_entry_id IS NULL
  AND parent.id = entity_members.entity_id
  AND match.organization_id = parent.organization_id
  AND match.id != entity_members.entity_id
  AND (
    lower(trim(match.name)) LIKE '%' || lower(trim(entity_members.name)) || '%'
    OR lower(trim(entity_members.name)) LIKE '%' || lower(trim(match.name)) || '%'
  );
