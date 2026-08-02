-- 086: AI-generated entity overviews (the entity counterpart of 084).
--
-- Same column shape + stale-flag + background-regeneration model as investments;
-- Postgres triggers flip ai_overview_stale whenever something material about the
-- entity changes (a document filed, a note, a governance change, a compliance
-- obligation, a cap-table/investment change, or a material field edit). The
-- shared cron/refresh-overviews worker drains stale entities alongside
-- investments.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS ai_overview                TEXT,
  ADD COLUMN IF NOT EXISTS ai_overview_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_overview_model          TEXT,
  ADD COLUMN IF NOT EXISTS ai_overview_fingerprint    TEXT,
  ADD COLUMN IF NOT EXISTS ai_overview_stale          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_overview_attempts       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_overview_cost_usd            NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_overview_input_tokens        INT,
  ADD COLUMN IF NOT EXISTS ai_overview_output_tokens       INT,
  ADD COLUMN IF NOT EXISTS ai_overview_cache_read_tokens   INT,
  ADD COLUMN IF NOT EXISTS ai_overview_cache_creation_tokens INT;

CREATE INDEX IF NOT EXISTS idx_entities_overview_stale
  ON entities (ai_overview_stale, ai_overview_attempts)
  WHERE ai_overview_stale = true;

CREATE OR REPLACE FUNCTION mark_entity_overview_stale(ent UUID)
RETURNS void AS $$
BEGIN
  IF ent IS NOT NULL THEN
    UPDATE entities
      SET ai_overview_stale = true, ai_overview_attempts = 0
      WHERE id = ent AND ai_overview_stale = false;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Child tables that carry entity_id directly.
CREATE OR REPLACE FUNCTION trg_entity_child_overview_stale()
RETURNS trigger AS $$
BEGIN
  PERFORM mark_entity_overview_stale(COALESCE(NEW.entity_id, OLD.entity_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- documents.entity_id (filing a doc to an entity, or moving it off).
CREATE OR REPLACE FUNCTION trg_entity_document_overview_stale()
RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM mark_entity_overview_stale(NEW.entity_id);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM mark_entity_overview_stale(OLD.entity_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- notes body/date edit → every entity the note is linked to.
CREATE OR REPLACE FUNCTION trg_note_entity_overview_stale()
RETURNS trigger AS $$
BEGIN
  UPDATE entities SET ai_overview_stale = true, ai_overview_attempts = 0
    WHERE ai_overview_stale = false
      AND id IN (SELECT entity_id FROM note_links WHERE note_id = NEW.id AND entity_id IS NOT NULL);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Material edits to the entity row itself. The WHEN clause (on the trigger)
-- excludes the ai_overview_stale flip, so marking stale can't recurse.
CREATE OR REPLACE FUNCTION trg_entity_self_overview_stale()
RETURNS trigger AS $$
BEGIN
  PERFORM mark_entity_overview_stale(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entity_member_overview_stale ON entity_members;
CREATE TRIGGER entity_member_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON entity_members
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS entity_manager_overview_stale ON entity_managers;
CREATE TRIGGER entity_manager_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON entity_managers
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS entity_registration_overview_stale ON entity_registrations;
CREATE TRIGGER entity_registration_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON entity_registrations
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS trust_role_overview_stale ON trust_roles;
CREATE TRIGGER trust_role_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON trust_roles
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS cap_table_overview_stale ON cap_table_entries;
CREATE TRIGGER cap_table_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON cap_table_entries
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS compliance_overview_stale ON compliance_obligations;
CREATE TRIGGER compliance_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON compliance_obligations
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS doc_entity_link_overview_stale ON document_entity_links;
CREATE TRIGGER doc_entity_link_overview_stale
  AFTER INSERT OR DELETE ON document_entity_links
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS note_link_entity_overview_stale ON note_links;
CREATE TRIGGER note_link_entity_overview_stale
  AFTER INSERT OR DELETE ON note_links
  FOR EACH ROW EXECUTE FUNCTION trg_entity_child_overview_stale();

DROP TRIGGER IF EXISTS document_entity_overview_stale ON documents;
CREATE TRIGGER document_entity_overview_stale
  AFTER INSERT OR UPDATE OF entity_id OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION trg_entity_document_overview_stale();

DROP TRIGGER IF EXISTS note_entity_overview_stale ON notes;
CREATE TRIGGER note_entity_overview_stale
  AFTER UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION trg_note_entity_overview_stale();

DROP TRIGGER IF EXISTS entity_self_overview_stale ON entities;
CREATE TRIGGER entity_self_overview_stale
  AFTER UPDATE ON entities
  FOR EACH ROW
  WHEN (OLD.ai_overview_stale IS NOT DISTINCT FROM NEW.ai_overview_stale)
  EXECUTE FUNCTION trg_entity_self_overview_stale();
