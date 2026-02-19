-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Directory entries
CREATE TABLE directory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type directory_entry_type NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_directory_name ON directory_entries(name);
CREATE INDEX idx_directory_type ON directory_entries(type);

-- Entities
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type entity_type NOT NULL,
  status entity_status NOT NULL DEFAULT 'active',
  ein TEXT,
  duns_number TEXT,
  formation_state jurisdiction NOT NULL,
  formed_date DATE,
  address TEXT,
  registered_agent TEXT,
  law_firm TEXT,
  bookkeeper TEXT,
  tax_accountant TEXT,
  parent_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_entities_parent ON entities(parent_entity_id);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_status ON entities(status);

-- Entity registrations
CREATE TABLE entity_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  jurisdiction jurisdiction NOT NULL,
  qualification_date DATE,
  last_filing_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, jurisdiction)
);
CREATE INDEX idx_registrations_entity ON entity_registrations(entity_id);

-- Entity state IDs
CREATE TABLE entity_state_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  jurisdiction jurisdiction NOT NULL,
  state_id_number TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, jurisdiction)
);
CREATE INDEX idx_state_ids_entity ON entity_state_ids(entity_id);

-- Entity managers
CREATE TABLE entity_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  directory_entry_id UUID REFERENCES directory_entries(id),
  ref_entity_id UUID REFERENCES entities(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, name)
);

-- Entity members
CREATE TABLE entity_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  directory_entry_id UUID REFERENCES directory_entries(id),
  ref_entity_id UUID REFERENCES entities(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, name)
);

-- Trust details
CREATE TABLE trust_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  trust_type trust_type NOT NULL,
  trust_date DATE,
  grantor_name TEXT,
  situs_state jurisdiction,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trust roles
CREATE TABLE trust_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trust_detail_id UUID NOT NULL REFERENCES trust_details(id) ON DELETE CASCADE,
  role trust_role_type NOT NULL,
  name TEXT NOT NULL,
  directory_entry_id UUID REFERENCES directory_entries(id),
  ref_entity_id UUID REFERENCES entities(id),
  effective_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trust_roles_trust ON trust_roles(trust_detail_id);

-- Custom field definitions
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  field_type custom_field_type NOT NULL DEFAULT 'text',
  options JSONB,
  is_global BOOLEAN DEFAULT false,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Custom field values
CREATE TABLE custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  field_def_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  value_text TEXT,
  value_boolean BOOLEAN,
  value_date DATE,
  value_number DECIMAL(18,4),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, field_def_id)
);

-- Relationships
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type relationship_type NOT NULL,
  description TEXT NOT NULL,
  terms TEXT,
  from_entity_id UUID REFERENCES entities(id),
  from_directory_id UUID REFERENCES directory_entries(id),
  to_entity_id UUID REFERENCES entities(id),
  to_directory_id UUID REFERENCES directory_entries(id),
  frequency payment_frequency NOT NULL DEFAULT 'na',
  status relationship_status NOT NULL DEFAULT 'active',
  effective_date DATE,
  termination_date DATE,
  annual_estimate BIGINT,
  document_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_from CHECK (
    (from_entity_id IS NOT NULL AND from_directory_id IS NULL) OR
    (from_entity_id IS NULL AND from_directory_id IS NOT NULL)
  ),
  CONSTRAINT chk_to CHECK (
    (to_entity_id IS NOT NULL AND to_directory_id IS NULL) OR
    (to_entity_id IS NULL AND to_directory_id IS NOT NULL)
  )
);
CREATE INDEX idx_rels_from_entity ON relationships(from_entity_id);
CREATE INDEX idx_rels_to_entity ON relationships(to_entity_id);
CREATE INDEX idx_rels_type ON relationships(type);

-- Cap table entries
CREATE TABLE cap_table_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  investor_entity_id UUID REFERENCES entities(id),
  investor_directory_id UUID REFERENCES directory_entries(id),
  investor_name TEXT,
  investor_type investor_type NOT NULL,
  units DECIMAL(18,4),
  ownership_pct DECIMAL(7,4) NOT NULL,
  capital_contributed BIGINT NOT NULL DEFAULT 0,
  investment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cap_entity ON cap_table_entries(entity_id);

-- State filing requirements
CREATE TABLE state_filing_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction jurisdiction NOT NULL,
  entity_type_scope entity_type,
  filing_type filing_type NOT NULL,
  filing_name TEXT NOT NULL,
  frequency_months INTEGER NOT NULL,
  typical_due_info TEXT,
  fee_estimate INTEGER,
  notes TEXT,
  UNIQUE(jurisdiction, filing_type, entity_type_scope)
);

-- Entity filings
CREATE TABLE entity_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  jurisdiction jurisdiction NOT NULL,
  filing_type filing_type NOT NULL,
  filing_name TEXT NOT NULL,
  filed_date DATE,
  due_date DATE,
  next_due_date DATE,
  confirmation TEXT,
  fee_paid INTEGER,
  document_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_filings_entity ON entity_filings(entity_id);
CREATE INDEX idx_filings_next_due ON entity_filings(next_due_date);
CREATE INDEX idx_filings_jurisdiction ON entity_filings(jurisdiction);

-- Documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type document_type NOT NULL,
  year INTEGER,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES users(id),
  ai_extracted BOOLEAN DEFAULT false,
  ai_extraction JSONB,
  ai_extracted_at TIMESTAMPTZ,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_docs_entity ON documents(entity_id);
CREATE INDEX idx_docs_type ON documents(document_type);

-- Chat sessions
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Chat messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_chat_msgs_session ON chat_messages(session_id);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);
