-- Migration 045: Link users to their personal entity for "me"/"my" resolution.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS primary_entity_id UUID REFERENCES entities(id);

COMMENT ON COLUMN user_profiles.primary_entity_id IS
  'The entity that represents this user personally (usually entity_type=person). Used by the chat to resolve "me", "my", "mine".';
