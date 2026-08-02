-- 085: Central AI-usage cost ledger.
--
-- One row per call to any AI service (Claude today; any provider tomorrow), so
-- cost-per-action is queryable in ONE place across every surface — chat,
-- document extraction, triage, investment overviews, and whatever comes next.
-- Per-surface columns (document_queue.extraction_cost_usd, investments.
-- ai_overview_cost_usd, chat_messages cost) still exist for their local UIs;
-- this ledger is the cross-surface source of truth for cost analytics and
-- mitigation-vs-performance tradeoffs as we scale.
--
-- Standing rule: every AI call site records a row here via recordAiUsage().

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Coarse call site: chat | document_extraction | triage | investment_overview | …
  surface         TEXT NOT NULL,
  -- Finer operation within a surface, optional (e.g. a specific tool or phase).
  action          TEXT,

  provider        TEXT NOT NULL DEFAULT 'anthropic',
  model           TEXT NOT NULL,

  -- The four billing classes, kept separate (cache reads/writes price very
  -- differently) so cost can be recomputed and cache efficiency measured.
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd               NUMERIC(12, 6) NOT NULL DEFAULT 0,

  latency_ms      INTEGER,
  -- What the call was about, for per-record cost attribution.
  resource_type   TEXT,
  resource_id     UUID,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  success         BOOLEAN NOT NULL DEFAULT true,
  error           TEXT,
  metadata        JSONB
);

-- Cost analytics: by org over time, and by surface.
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_time ON ai_usage_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_surface_time ON ai_usage_events (surface, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_resource ON ai_usage_events (resource_type, resource_id);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Members can read their own org's usage (for in-app cost views later); writes
-- come from server code via the service-role client (system jobs have no user
-- context), so no INSERT policy for authenticated is needed.
CREATE POLICY ai_usage_org_read ON ai_usage_events FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));
