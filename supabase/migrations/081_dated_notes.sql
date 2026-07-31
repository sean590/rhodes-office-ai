-- 081: Dated notes on records (rhodes-future-enhancements.md §7).
--
-- Free-form, DATED, authored notes to memorialize non-document context —
-- phone calls, meeting notes, decisions. A note can attach to MULTIPLE records
-- of different kinds at once (an entity AND an investment AND an external
-- contact) via the note_links junction, which uses per-type FKs (real
-- referential integrity + cascade, not stringly-typed polymorphism).

CREATE TABLE IF NOT EXISTS notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  -- The "dated" aspect — when the memorialized thing happened (a call date),
  -- user-settable, distinct from created_at (when it was entered).
  note_date       DATE NOT NULL DEFAULT current_date,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_org_date ON notes (organization_id, note_date DESC);

-- One row per (note, target). Exactly one target FK is set per row; a note gets
-- one link row per record it's attached to. Every target FK cascades, so a note
-- link vanishes when its target is deleted (the note itself survives if it has
-- other links).
CREATE TABLE IF NOT EXISTS note_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id          UUID REFERENCES entities(id) ON DELETE CASCADE,
  investment_id      UUID REFERENCES investments(id) ON DELETE CASCADE,
  directory_entry_id UUID REFERENCES directory_entries(id) ON DELETE CASCADE,
  document_id        UUID REFERENCES documents(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT note_links_exactly_one_target CHECK (
    (entity_id IS NOT NULL)::int
    + (investment_id IS NOT NULL)::int
    + (directory_entry_id IS NOT NULL)::int
    + (document_id IS NOT NULL)::int = 1
  )
);

-- Reverse lookups: "all notes for this entity/investment/contact/document".
CREATE INDEX IF NOT EXISTS idx_note_links_entity   ON note_links (entity_id)          WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_invest   ON note_links (investment_id)      WHERE investment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_contact  ON note_links (directory_entry_id) WHERE directory_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_document ON note_links (document_id)        WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_note     ON note_links (note_id);
-- No duplicate link of the same note to the same target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique
  ON note_links (note_id, entity_id, investment_id, directory_entry_id, document_id);

ALTER TABLE notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON notes FOR ALL TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY org_isolation ON note_links FOR ALL TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
