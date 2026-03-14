-- Entity recurrence signals: stores termination/wind-down signals
-- detected from document content to suppress future recurring expectations.

CREATE TABLE entity_recurrence_signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,                -- 'investment_wind_down', 'entity_dissolution', 'contract_termination', 'ownership_transfer'
  related_entity_name TEXT,                 -- investment/counterparty name
  related_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  jurisdiction TEXT,                        -- state code if applicable
  effective_date DATE,                      -- when the termination takes effect
  document_types_affected TEXT[] NOT NULL,  -- array of document type slugs
  source_document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  confidence FLOAT NOT NULL,               -- 0.0-1.0
  reason TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,           -- user can override/dismiss
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_recurrence_signals_entity ON entity_recurrence_signals(entity_id) WHERE is_active = true;
CREATE INDEX idx_recurrence_signals_org ON entity_recurrence_signals(organization_id);

-- RLS
ALTER TABLE entity_recurrence_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can access recurrence signals"
  ON entity_recurrence_signals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
