-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_state_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE cap_table_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_filing_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write all data (internal tool, all users trusted)

-- users
CREATE POLICY "authenticated_select" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON users FOR DELETE TO authenticated USING (true);

-- directory_entries
CREATE POLICY "authenticated_select" ON directory_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON directory_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON directory_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON directory_entries FOR DELETE TO authenticated USING (true);

-- entities
CREATE POLICY "authenticated_select" ON entities FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entities FOR DELETE TO authenticated USING (true);

-- entity_registrations
CREATE POLICY "authenticated_select" ON entity_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entity_registrations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entity_registrations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entity_registrations FOR DELETE TO authenticated USING (true);

-- entity_state_ids
CREATE POLICY "authenticated_select" ON entity_state_ids FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entity_state_ids FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entity_state_ids FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entity_state_ids FOR DELETE TO authenticated USING (true);

-- entity_managers
CREATE POLICY "authenticated_select" ON entity_managers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entity_managers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entity_managers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entity_managers FOR DELETE TO authenticated USING (true);

-- entity_members
CREATE POLICY "authenticated_select" ON entity_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entity_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entity_members FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entity_members FOR DELETE TO authenticated USING (true);

-- trust_details
CREATE POLICY "authenticated_select" ON trust_details FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON trust_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON trust_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON trust_details FOR DELETE TO authenticated USING (true);

-- trust_roles
CREATE POLICY "authenticated_select" ON trust_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON trust_roles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON trust_roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON trust_roles FOR DELETE TO authenticated USING (true);

-- custom_field_definitions
CREATE POLICY "authenticated_select" ON custom_field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON custom_field_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON custom_field_definitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON custom_field_definitions FOR DELETE TO authenticated USING (true);

-- custom_field_values
CREATE POLICY "authenticated_select" ON custom_field_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON custom_field_values FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON custom_field_values FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON custom_field_values FOR DELETE TO authenticated USING (true);

-- relationships
CREATE POLICY "authenticated_select" ON relationships FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON relationships FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON relationships FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON relationships FOR DELETE TO authenticated USING (true);

-- cap_table_entries
CREATE POLICY "authenticated_select" ON cap_table_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON cap_table_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON cap_table_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON cap_table_entries FOR DELETE TO authenticated USING (true);

-- state_filing_requirements
CREATE POLICY "authenticated_select" ON state_filing_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON state_filing_requirements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON state_filing_requirements FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON state_filing_requirements FOR DELETE TO authenticated USING (true);

-- entity_filings
CREATE POLICY "authenticated_select" ON entity_filings FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON entity_filings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON entity_filings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON entity_filings FOR DELETE TO authenticated USING (true);

-- documents
CREATE POLICY "authenticated_select" ON documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON documents FOR DELETE TO authenticated USING (true);

-- chat_sessions
CREATE POLICY "authenticated_select" ON chat_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON chat_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON chat_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON chat_sessions FOR DELETE TO authenticated USING (true);

-- chat_messages
CREATE POLICY "authenticated_select" ON chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON chat_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON chat_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON chat_messages FOR DELETE TO authenticated USING (true);

-- audit_log
CREATE POLICY "authenticated_select" ON audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON audit_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON audit_log FOR DELETE TO authenticated USING (true);
