-- 082: Allocation member-name fallback.
--
-- Internal allocations point at a member via member_entity_id (a linked entity,
-- e.g. a trust) or member_directory_id (a directory individual). A NAME-ONLY
-- member — an entity_members row with a name but neither link — has no id to
-- store, so its allocation saved with both ids null and the table rendered
-- "Unknown". This column stores the member's display name as a fallback; the
-- API prefers the freshly-resolved entity/directory name and only falls back to
-- this when neither id resolves.
ALTER TABLE investment_allocations
  ADD COLUMN IF NOT EXISTS member_name TEXT;
