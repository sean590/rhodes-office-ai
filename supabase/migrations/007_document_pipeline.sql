-- ============================================================================
-- 007: Document Pipeline — Staged upload, extraction queue, dynamic doc types
-- ============================================================================

-- 1a. document_types table (replaces hardcoded TypeScript union)
CREATE TABLE document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  short_label TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  jurisdiction TEXT,
  form_number TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_document_types_slug ON document_types(slug);
CREATE INDEX idx_document_types_category ON document_types(category);

-- Seed all existing document types
INSERT INTO document_types (slug, label, short_label, category, is_seed) VALUES
  -- Formation
  ('operating_agreement', 'Operating Agreement', 'Op Agreement', 'formation', true),
  ('amended_operating_agreement', 'Amended Operating Agreement', 'Amended OA', 'formation', true),
  ('certificate_of_formation', 'Certificate of Formation', 'Cert of Formation', 'formation', true),
  ('articles_of_incorporation', 'Articles of Incorporation', 'Articles of Incorp', 'formation', true),
  ('articles_of_organization', 'Articles of Organization', 'Articles of Org', 'formation', true),
  ('bylaws', 'Bylaws', 'Bylaws', 'formation', true),
  ('partnership_agreement', 'Partnership Agreement', 'Partnership Agmt', 'formation', true),
  ('trust_agreement', 'Trust Agreement', 'Trust Agmt', 'formation', true),
  ('trust_amendment', 'Trust Amendment', 'Trust Amendment', 'formation', true),
  -- Tax
  ('ein_letter', 'EIN Letter', 'EIN Letter', 'tax', true),
  ('tax_return_1065', 'Tax Return (1065)', '1065', 'tax', true),
  ('tax_return_1120s', 'Tax Return (1120-S)', '1120-S', 'tax', true),
  ('tax_return_1041', 'Tax Return (1041)', '1041', 'tax', true),
  ('tax_return_1040', 'Tax Return (1040)', '1040', 'tax', true),
  ('k1', 'K-1', 'K-1', 'tax', true),
  ('w9', 'W-9', 'W-9', 'tax', true),
  ('w8ben', 'W-8BEN', 'W-8BEN', 'tax', true),
  ('ca_form_3522', 'CA Form 3522 (LLC Tax Voucher)', 'CA 3522', 'tax', true),
  ('ca_form_3536', 'CA Form 3536 (Estimated Fee)', 'CA 3536', 'tax', true),
  ('ca_form_100es', 'CA Form 100-ES (Estimated Tax)', 'CA 100-ES', 'tax', true),
  ('franchise_tax_payment', 'State Tax Payment', 'State Tax', 'tax', true),
  -- Investor
  ('subscription_agreement', 'Subscription Agreement', 'Sub Agreement', 'investor', true),
  ('capital_call_notice', 'Capital Call Notice', 'Capital Call', 'investor', true),
  ('distribution_notice', 'Distribution Notice', 'Distribution', 'investor', true),
  ('investor_questionnaire', 'Investor Questionnaire', 'IQ', 'investor', true),
  ('side_letter', 'Side Letter', 'Side Letter', 'investor', true),
  ('ppm', 'Private Placement Memorandum', 'PPM', 'investor', true),
  ('cap_table', 'Cap Table', 'Cap Table', 'investor', true),
  -- Contracts
  ('management_agreement', 'Management Agreement', 'Mgmt Agreement', 'contracts', true),
  ('advisory_agreement', 'Advisory Agreement', 'Advisory Agmt', 'contracts', true),
  ('consulting_agreement', 'Consulting Agreement', 'Consulting Agmt', 'contracts', true),
  ('service_agreement', 'Service Agreement', 'Service Agmt', 'contracts', true),
  ('license_agreement', 'License Agreement', 'License Agmt', 'contracts', true),
  ('lease_agreement', 'Lease Agreement', 'Lease Agmt', 'contracts', true),
  ('promissory_note', 'Promissory Note', 'Prom Note', 'contracts', true),
  ('loan_agreement', 'Loan Agreement', 'Loan Agmt', 'contracts', true),
  ('guarantee', 'Guarantee', 'Guarantee', 'contracts', true),
  ('assignment', 'Assignment', 'Assignment', 'contracts', true),
  ('amendment', 'Amendment', 'Amendment', 'contracts', true),
  -- Compliance
  ('annual_report', 'Annual Report', 'Annual Report', 'compliance', true),
  ('statement_of_information', 'Statement of Information', 'SOI', 'compliance', true),
  ('certificate_of_good_standing', 'Certificate of Good Standing', 'Good Standing', 'compliance', true),
  ('foreign_qualification', 'Foreign Qualification', 'Foreign Qual', 'compliance', true),
  ('registered_agent_appointment', 'Registered Agent Appointment', 'Reg Agent', 'compliance', true),
  -- Insurance
  ('certificate_of_insurance', 'Certificate of Insurance', 'COI', 'insurance', true),
  ('insurance_policy', 'Insurance Policy', 'Insurance', 'insurance', true),
  -- Governance
  ('board_resolution', 'Board Resolution', 'Board Resolution', 'governance', true),
  ('consent_of_members', 'Consent of Members', 'Consent', 'governance', true),
  ('meeting_minutes', 'Meeting Minutes', 'Minutes', 'governance', true),
  ('power_of_attorney', 'Power of Attorney', 'POA', 'governance', true),
  -- Other
  ('payment_confirmation', 'Payment Confirmation', 'Payment Conf', 'other', true),
  ('business_license_receipt', 'Business License Receipt', 'Biz License', 'other', true),
  ('tax_package', 'Tax Package (Composite)', 'Tax Package', 'tax', true),
  ('other', 'Other', 'Other', 'other', true);


-- 1b. queue_status enum
CREATE TYPE queue_status AS ENUM (
  'uploaded', 'staged', 'queued', 'extracting', 'extracted',
  'review_ready', 'approved', 'rejected', 'error'
);

-- 1c. document_queue table
CREATE TABLE document_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  status queue_status NOT NULL DEFAULT 'uploaded',

  -- Upload info
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  content_hash TEXT,

  -- Staging (filename heuristic) columns
  staged_doc_type TEXT,
  staged_entity_id UUID REFERENCES entities(id),
  staged_entity_name TEXT,
  staged_year INTEGER,
  staged_category TEXT,
  staging_confidence TEXT,
  user_corrected BOOLEAN NOT NULL DEFAULT false,

  -- AI extraction columns
  ai_extraction JSONB,
  ai_summary TEXT,
  ai_document_type TEXT,
  ai_document_category TEXT,
  ai_entity_id UUID REFERENCES entities(id),
  ai_year INTEGER,
  ai_confidence DECIMAL(3,2),
  ai_proposed_actions JSONB,
  ai_direction TEXT,
  ai_proposed_entity JSONB,

  -- Composite document columns
  is_composite BOOLEAN NOT NULL DEFAULT false,
  parent_queue_id UUID REFERENCES document_queue(id),
  ai_jurisdiction TEXT,
  ai_page_range INTEGER[],
  ai_k1_recipient TEXT,
  ai_suggested_name TEXT,

  -- Processing columns
  extraction_started_at TIMESTAMPTZ,
  extraction_completed_at TIMESTAMPTZ,
  extraction_error TEXT,
  extraction_tokens INTEGER,
  pdf_page_count INTEGER,
  pdf_tier TEXT,

  -- Review columns
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,

  -- Result
  document_id UUID REFERENCES documents(id),

  -- Source tracking
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_ref TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_queue_batch ON document_queue(batch_id);
CREATE INDEX idx_queue_status ON document_queue(status);
CREATE INDEX idx_queue_content_hash ON document_queue(content_hash);
CREATE INDEX idx_queue_ai_entity ON document_queue(ai_entity_id);
CREATE INDEX idx_queue_source_type ON document_queue(source_type);
CREATE INDEX idx_queue_parent ON document_queue(parent_queue_id);


-- 1d. document_batches table
CREATE TYPE batch_status AS ENUM ('staging', 'processing', 'review', 'completed');

CREATE TABLE document_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  source_type TEXT NOT NULL DEFAULT 'upload',
  status batch_status NOT NULL DEFAULT 'staging',
  context TEXT NOT NULL DEFAULT 'global',  -- global | entity | onboarding
  entity_id UUID REFERENCES entities(id),
  entity_discovery BOOLEAN NOT NULL DEFAULT false,

  -- Stats
  total_documents INTEGER NOT NULL DEFAULT 0,
  staged_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  extracted_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  new_entities_proposed INTEGER NOT NULL DEFAULT 0,
  new_entities_created INTEGER NOT NULL DEFAULT 0,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_batches_status ON document_batches(status);
CREATE INDEX idx_batches_created_by ON document_batches(created_by);
CREATE INDEX idx_batches_entity ON document_batches(entity_id);

-- Add FK from queue to batches now that both tables exist
ALTER TABLE document_queue
  ADD CONSTRAINT fk_queue_batch FOREIGN KEY (batch_id) REFERENCES document_batches(id) ON DELETE CASCADE;


-- 1e. Extend documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_page_range INTEGER[];
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS k1_recipient TEXT;

-- Make entity_id nullable (allow unassociated documents)
ALTER TABLE documents ALTER COLUMN entity_id DROP NOT NULL;

-- Drop the foreign key constraint that enforces NOT NULL via CASCADE
-- and recreate it allowing NULL
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_id_fkey;
ALTER TABLE documents ADD CONSTRAINT documents_entity_id_fkey
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;


-- 1f. Convert documents.document_type from enum to TEXT
ALTER TABLE documents ALTER COLUMN document_type TYPE TEXT;


-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read document types" ON document_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert document types" ON document_types
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update document types" ON document_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE document_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access to queue" ON document_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE document_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read batches" ON document_batches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert batches" ON document_batches
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update batches" ON document_batches
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
