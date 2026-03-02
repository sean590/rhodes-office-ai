-- ============================================================================
-- 011: Organizations — Multi-tenancy layer
-- ============================================================================

-- 1. Org role enum
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- 2. Organizations table
-- NOTE: user FKs reference auth.users(id) because the app uses auth UUIDs everywhere.
-- The legacy `users` table has its own internal `id` (different from auth UUID).
CREATE TABLE organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  billing_email TEXT,
  billing_plan TEXT DEFAULT 'free',
  billing_status TEXT DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_created_by ON organizations(created_by);

-- 3. Organization members
CREATE TABLE organization_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES auth.users(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- 4. Organization invites
CREATE TABLE organization_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role org_role NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ
);

CREATE INDEX idx_org_invites_org ON organization_invites(organization_id);
CREATE INDEX idx_org_invites_token ON organization_invites(token);
CREATE INDEX idx_org_invites_email ON organization_invites(email);

-- 5. Formalize user_profiles (may already exist from manual creation)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add active_organization_id to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS active_organization_id UUID REFERENCES organizations(id);

-- ============================================================================
-- 6. Add organization_id to root tables
-- ============================================================================

-- entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_entities_org ON entities(organization_id);

-- directory_entries
ALTER TABLE directory_entries ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_directory_org ON directory_entries(organization_id);

-- relationships
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_relationships_org ON relationships(organization_id);

-- documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization_id);

-- chat_sessions
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_org ON chat_sessions(organization_id);

-- document_batches
ALTER TABLE document_batches ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_document_batches_org ON document_batches(organization_id);

-- audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(organization_id);

-- custom_field_definitions
ALTER TABLE custom_field_definitions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_org ON custom_field_definitions(organization_id);

-- document_types
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_document_types_org ON document_types(organization_id);

-- ============================================================================
-- 7. Seed a default org and backfill existing data
-- ============================================================================

-- Create default org for existing data
INSERT INTO organizations (id, name, slug, billing_plan, billing_status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', 'free', 'active');

-- Backfill organization_id on all root tables
UPDATE entities SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE directory_entries SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE relationships SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE documents SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE chat_sessions SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE document_batches SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE audit_log SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE custom_field_definitions SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE document_types SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;

-- Now make organization_id NOT NULL
ALTER TABLE entities ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE directory_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE relationships ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE documents ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE document_batches ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE document_types ALTER COLUMN organization_id SET NOT NULL;
-- audit_log stays nullable (system events may not have an org)

-- Add existing users as members of default org
INSERT INTO organization_members (organization_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id, 'owner'::org_role
FROM user_profiles
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Set active_organization_id for existing users
UPDATE user_profiles SET active_organization_id = '00000000-0000-0000-0000-000000000001'
WHERE active_organization_id IS NULL;

-- ============================================================================
-- 8. RLS policies on new tables (permissive for now)
-- ============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read organizations" ON organizations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert organizations" ON organizations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update organizations" ON organizations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access to org members" ON organization_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access to org invites" ON organization_invites
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
