-- =============================================================================
-- Plinth AI — Seed Data
-- =============================================================================
-- Deterministic UUIDs using pattern 00000000-0000-0000-0000-00000000XXXX
--
-- Directory entries:   ...0101 – ...0114
-- Entities:            ...0201 – ...0207
-- Trust details:       ...0301
-- Custom field defs:   ...0401 – ...0414
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. State Filing Requirements (15 rows)
-- =============================================================================
INSERT INTO state_filing_requirements (jurisdiction, filing_type, filing_name, frequency_months, typical_due_info, fee_estimate) VALUES
  ('DE', 'franchise_tax',          'Annual Franchise Tax Report',               12,  'June 1 each year',                                  30000),
  ('CA', 'statement_of_information','Statement of Information (LLC)',            24,  'Within 90 days of formation, then biennially',       2000),
  ('CA', 'franchise_tax',          'Annual Franchise Tax ($800 min)',            12,  'April 15 each year',                                80000),
  ('FL', 'annual_report',          'Annual Report',                             12,  'May 1 each year',                                   13875),
  ('NY', 'biennial_report',        'Biennial Statement',                        24,  'Anniversary of formation month',                      900),
  ('TX', 'franchise_tax',          'Annual Franchise Tax Report',               12,  'May 15 each year',                                      0),
  ('NV', 'annual_list',            'Annual List of Managers/Members',           12,  'Last day of anniversary month',                     15000),
  ('IL', 'annual_report',          'Annual Report',                             12,  'Before first day of anniversary month',              7500),
  ('GA', 'annual_report',          'Annual Registration',                       12,  'April 1 each year',                                  5000),
  ('NJ', 'annual_report',          'Annual Report',                             12,  'Last day of anniversary month',                      7500),
  ('WA', 'annual_report',          'Annual Report',                             12,  'End of formation anniversary month',                 7100),
  ('CO', 'periodic_report',        'Periodic Report',                           12,  'During anniversary month + 2 months',                1000),
  ('MA', 'annual_report',          'Annual Report',                             12,  'Anniversary of formation',                          50000),
  ('OH', 'annual_report',          'N/A - No annual filing required',            0,  'Ohio does not require annual reports',                   0),
  ('PA', 'annual_report',          'Decennial Report',                         120,  'Every 10 years',                                     7000);

-- =============================================================================
-- 2. Directory Entries (14 rows)
-- =============================================================================
INSERT INTO directory_entries (id, name, type, email) VALUES
  ('00000000-0000-0000-0000-000000000101', 'Sean Demetree',               'individual',      'sean@demetree.com'),
  ('00000000-0000-0000-0000-000000000102', 'Lauren Demetree',             'individual',      'lauren@demetree.com'),
  ('00000000-0000-0000-0000-000000000103', 'Maria Chen',                  'individual',      'maria@demetree.com'),
  ('00000000-0000-0000-0000-000000000104', 'James Wright',                'individual',      'james@external.com'),
  ('00000000-0000-0000-0000-000000000105', 'Sean Demetree Jr.',           'individual',      NULL),
  ('00000000-0000-0000-0000-000000000106', 'Emily Demetree',              'individual',      NULL),
  ('00000000-0000-0000-0000-000000000107', 'David Park',                  'individual',      'dpark@ridgecap.com'),
  ('00000000-0000-0000-0000-000000000108', 'Ridge Capital Management LLC','external_entity', NULL),
  ('00000000-0000-0000-0000-000000000109', 'Coastal Ventures LP',         'external_entity', NULL),
  ('00000000-0000-0000-0000-000000000110', 'Greenfield Family Office',    'external_entity', NULL),
  ('00000000-0000-0000-0000-000000000111', 'J. Harrison Trust',           'trust',           NULL),
  ('00000000-0000-0000-0000-000000000112', 'Baker McKenzie',              'external_entity', NULL),
  ('00000000-0000-0000-0000-000000000113', 'CT Corporation',              'external_entity', NULL),
  ('00000000-0000-0000-0000-000000000114', 'External Investors',          'external_entity', NULL);

-- =============================================================================
-- 3. Entities (7 rows)
-- =============================================================================
-- Insert parent-less entities first, then children (for FK on parent_entity_id).
-- e1 (Holdings) and e7 (Family Trust) have no parent.
-- e2 (DCP) and e4 (Palisades) and e6 (Awary) reference e1 (Holdings).
-- e3 (Tall Oil) and e5 (Chem Derivatives) reference e2 (DCP).

INSERT INTO entities (id, name, type, status, ein, formation_state, formed_date, registered_agent, address, parent_entity_id) VALUES
  -- No parent
  ('00000000-0000-0000-0000-000000000201', 'Demetree Holdings LLC',         'holding_company',  'active', '88-1234567', 'DE', '2019-03-15', 'CT Corporation',            '1209 Orange St, Wilmington, DE 19801',       NULL),
  ('00000000-0000-0000-0000-000000000207', 'Demetree Family Trust',         'trust',            'active', '88-7890123', 'FL', '2018-06-15', 'N/A',                       '200 S Orange Ave, Orlando, FL 32801',        NULL),
  -- Parent = Holdings (e1)
  ('00000000-0000-0000-0000-000000000202', 'Demetree Capital Partners LLC', 'investment_fund',  'active', '88-2345678', 'DE', '2020-06-01', 'CT Corporation',            '1209 Orange St, Wilmington, DE 19801',       '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000204', 'Palisades Development LLC',     'real_estate',      'active', '88-4567890', 'DE', '2022-08-20', 'LegalZoom',                 '15233 Ventura Blvd, Sherman Oaks, CA 91403', '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000206', 'Awary Technologies LLC',        'operating_company','active', '88-6789012', 'DE', '2024-05-01', 'CT Corporation',            '1209 Orange St, Wilmington, DE 19801',       '00000000-0000-0000-0000-000000000201'),
  -- Parent = DCP (e2)
  ('00000000-0000-0000-0000-000000000203', 'Tall Oil Processing Co LLC',    'operating_company','active', '88-3456789', 'FL', '2021-01-10', 'Sunbiz Registered Agents',  '200 S Orange Ave, Orlando, FL 32801',        '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000205', 'Chemical Derivatives Fund I LLC','investment_fund', 'active', '88-5678901', 'DE', '2023-02-14', 'CT Corporation',            '1209 Orange St, Wilmington, DE 19801',       '00000000-0000-0000-0000-000000000202');

-- =============================================================================
-- 4. Entity Registrations
-- =============================================================================
-- Formation-state registration + any additional foreign qualifications.
-- Holdings: DE (formation) + CA
-- DCP: DE (formation)
-- Tall Oil: FL (formation) + TX
-- Palisades: DE (formation) + CA
-- Chem Derivatives: DE (formation)
-- Awary: DE (formation) + CA
-- Family Trust: FL (formation)

INSERT INTO entity_registrations (entity_id, jurisdiction, qualification_date, last_filing_date) VALUES
  -- Holdings (e1) — DE formation, CA registration
  ('00000000-0000-0000-0000-000000000201', 'DE', '2019-03-15', '2024-03-01'),
  ('00000000-0000-0000-0000-000000000201', 'CA', '2019-06-01', '2024-03-01'),
  -- DCP (e2) — DE formation
  ('00000000-0000-0000-0000-000000000202', 'DE', '2020-06-01', '2024-03-01'),
  -- Tall Oil (e3) — FL formation, TX registration
  ('00000000-0000-0000-0000-000000000203', 'FL', '2021-01-10', '2025-01-15'),
  ('00000000-0000-0000-0000-000000000203', 'TX', '2021-04-01', '2025-01-15'),
  -- Palisades (e4) — DE formation, CA registration
  ('00000000-0000-0000-0000-000000000204', 'DE', '2022-08-20', '2024-08-20'),
  ('00000000-0000-0000-0000-000000000204', 'CA', '2022-11-01', '2024-08-20'),
  -- Chem Derivatives (e5) — DE formation
  ('00000000-0000-0000-0000-000000000205', 'DE', '2023-02-14', '2025-02-01'),
  -- Awary (e6) — DE formation, CA registration
  ('00000000-0000-0000-0000-000000000206', 'DE', '2024-05-01', '2025-01-20'),
  ('00000000-0000-0000-0000-000000000206', 'CA', '2024-07-01', '2025-01-20'),
  -- Family Trust (e7) — FL formation
  ('00000000-0000-0000-0000-000000000207', 'FL', '2018-06-15', NULL);

-- =============================================================================
-- 5. Entity Managers
-- =============================================================================
-- Holdings: Sean Demetree
-- DCP: Sean Demetree
-- Tall Oil: Sean Demetree + Maria Chen
-- Palisades: Sean Demetree
-- Chem Derivatives: Sean Demetree
-- Awary: Sean Demetree
-- Family Trust: (no managers)

INSERT INTO entity_managers (entity_id, name, directory_entry_id) VALUES
  -- Holdings
  ('00000000-0000-0000-0000-000000000201', 'Sean Demetree', '00000000-0000-0000-0000-000000000101'),
  -- DCP
  ('00000000-0000-0000-0000-000000000202', 'Sean Demetree', '00000000-0000-0000-0000-000000000101'),
  -- Tall Oil
  ('00000000-0000-0000-0000-000000000203', 'Sean Demetree', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000203', 'Maria Chen',    '00000000-0000-0000-0000-000000000103'),
  -- Palisades
  ('00000000-0000-0000-0000-000000000204', 'Sean Demetree', '00000000-0000-0000-0000-000000000101'),
  -- Chem Derivatives
  ('00000000-0000-0000-0000-000000000205', 'Sean Demetree', '00000000-0000-0000-0000-000000000101'),
  -- Awary
  ('00000000-0000-0000-0000-000000000206', 'Sean Demetree', '00000000-0000-0000-0000-000000000101');

-- =============================================================================
-- 6. Entity Members
-- =============================================================================
-- Holdings: Sean Demetree (directory) + Maria Chen (directory)
-- DCP: Demetree Holdings LLC (entity ref)
-- Tall Oil: DCP (entity ref)
-- Palisades: Holdings (entity ref)
-- Chem Derivatives: DCP (entity ref) + External Investors (directory ref)
-- Awary: Holdings (entity ref)
-- Family Trust: Sean Demetree (directory) + Lauren Demetree (directory)

INSERT INTO entity_members (entity_id, name, directory_entry_id, ref_entity_id) VALUES
  -- Holdings members (individuals via directory)
  ('00000000-0000-0000-0000-000000000201', 'Sean Demetree',          '00000000-0000-0000-0000-000000000101', NULL),
  ('00000000-0000-0000-0000-000000000201', 'Maria Chen',             '00000000-0000-0000-0000-000000000103', NULL),
  -- DCP member (entity)
  ('00000000-0000-0000-0000-000000000202', 'Demetree Holdings LLC',  NULL, '00000000-0000-0000-0000-000000000201'),
  -- Tall Oil member (entity)
  ('00000000-0000-0000-0000-000000000203', 'Demetree Capital Partners LLC', NULL, '00000000-0000-0000-0000-000000000202'),
  -- Palisades member (entity)
  ('00000000-0000-0000-0000-000000000204', 'Demetree Holdings LLC',  NULL, '00000000-0000-0000-0000-000000000201'),
  -- Chem Derivatives members (entity + directory)
  ('00000000-0000-0000-0000-000000000205', 'Demetree Capital Partners LLC', NULL, '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000205', 'External Investors',     '00000000-0000-0000-0000-000000000114', NULL),
  -- Awary member (entity)
  ('00000000-0000-0000-0000-000000000206', 'Demetree Holdings LLC',  NULL, '00000000-0000-0000-0000-000000000201'),
  -- Family Trust members (individuals via directory)
  ('00000000-0000-0000-0000-000000000207', 'Sean Demetree',          '00000000-0000-0000-0000-000000000101', NULL),
  ('00000000-0000-0000-0000-000000000207', 'Lauren Demetree',        '00000000-0000-0000-0000-000000000102', NULL);

-- =============================================================================
-- 7. Trust Details + Trust Roles for Family Trust (e7)
-- =============================================================================
INSERT INTO trust_details (id, entity_id, trust_type, trust_date, grantor_name, situs_state) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000207', 'irrevocable', '2018-06-15', 'Sean Demetree', 'FL');

INSERT INTO trust_roles (trust_detail_id, role, name, directory_entry_id) VALUES
  ('00000000-0000-0000-0000-000000000301', 'grantor',                'Sean Demetree',    '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000301', 'trustee',                'Lauren Demetree',  '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000301', 'trustee',                'James Wright',     '00000000-0000-0000-0000-000000000104'),
  ('00000000-0000-0000-0000-000000000301', 'successor_trustee',      'Maria Chen',       '00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-000000000301', 'beneficiary',            'Sean Demetree Jr.','00000000-0000-0000-0000-000000000105'),
  ('00000000-0000-0000-0000-000000000301', 'beneficiary',            'Emily Demetree',   '00000000-0000-0000-0000-000000000106'),
  ('00000000-0000-0000-0000-000000000301', 'contingent_beneficiary', 'Lauren Demetree',  '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000301', 'trust_protector',        'James Wright',     '00000000-0000-0000-0000-000000000104'),
  ('00000000-0000-0000-0000-000000000301', 'investment_advisor',     'David Park',       '00000000-0000-0000-0000-000000000107'),
  ('00000000-0000-0000-0000-000000000301', 'distribution_advisor',   'Maria Chen',       '00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-000000000301', 'trust_counsel',          'Baker McKenzie',   '00000000-0000-0000-0000-000000000112');

-- =============================================================================
-- 8. Relationships (5 rows)
-- =============================================================================
-- All annual_estimate values in cents.
-- Ridge Capital (directory ...0108) is the "from" side for the first 3 relationships.
-- Holdings/DCP (entities) are the "from" side for the last 2.

INSERT INTO relationships (type, description, terms, from_entity_id, from_directory_id, to_entity_id, to_directory_id, frequency, status, effective_date, annual_estimate, document_ref) VALUES
  -- Ridge -> Tall Oil: profit_share
  ('profit_share',    '20% profit share on NOI',
   '20% of NOI, quarterly, 8% pref return hurdle',
   NULL, '00000000-0000-0000-0000-000000000108',
   '00000000-0000-0000-0000-000000000203', NULL,
   'quarterly', 'active', '2021-03-01', 42000000,
   'Management Agreement — §4.2'),

  -- Ridge -> DCP: fixed_fee
  ('fixed_fee',       'Monthly advisory fee',
   '$15,000/mo fixed advisory & deal sourcing',
   NULL, '00000000-0000-0000-0000-000000000108',
   '00000000-0000-0000-0000-000000000202', NULL,
   'monthly', 'active', '2020-09-01', 18000000,
   'Advisory Agreement 9/1/2020'),

  -- Ridge -> Chem Derivatives: management_fee
  ('management_fee',  '2% annual mgmt fee on committed capital',
   '2% of $12M committed, quarterly in advance',
   NULL, '00000000-0000-0000-0000-000000000108',
   '00000000-0000-0000-0000-000000000205', NULL,
   'quarterly', 'active', '2023-03-01', 24000000,
   NULL),

  -- Holdings -> Awary: loan
  ('loan',            'Working capital LOC',
   '$500K revolving at 6%, interest-only 24mo',
   '00000000-0000-0000-0000-000000000201', NULL,
   '00000000-0000-0000-0000-000000000206', NULL,
   'monthly', 'active', '2024-06-01', 3000000,
   'Promissory Note 6/1/2024'),

  -- DCP -> Tall Oil: equity
  ('equity',          '65% membership interest',
   '65% economic interest, full voting',
   '00000000-0000-0000-0000-000000000202', NULL,
   '00000000-0000-0000-0000-000000000203', NULL,
   'na', 'active', '2021-01-10', NULL,
   NULL);

-- =============================================================================
-- 9. Cap Table Entries
-- =============================================================================
-- All capital_contributed values in cents.

-- Holdings (e1): total raised = $2,000,000 = 200000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000201', NULL, '00000000-0000-0000-0000-000000000101', 'Sean Demetree', 'individual', 900, 90.0000, 180000000, '2019-03-15'),
  ('00000000-0000-0000-0000-000000000201', NULL, '00000000-0000-0000-0000-000000000103', 'Maria Chen',    'individual', 100, 10.0000,  20000000, '2019-03-15');

-- DCP (e2): total raised = $5,000,000 = 500000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000201', NULL, 'Demetree Holdings LLC', 'entity', 5000, 100.0000, 500000000, '2020-06-01');

-- Tall Oil (e3): total raised = $3,200,000 = 320000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000202', NULL,                                    'Demetree Capital Partners LLC', 'entity',        650, 65.0000, 208000000, '2021-01-10'),
  ('00000000-0000-0000-0000-000000000203', NULL,                                   '00000000-0000-0000-0000-000000000109',   'Coastal Ventures LP',           'external_fund', 200, 20.0000,  64000000, '2021-01-10'),
  ('00000000-0000-0000-0000-000000000203', NULL,                                   '00000000-0000-0000-0000-000000000111',   'J. Harrison Trust',             'trust',         150, 15.0000,  48000000, '2021-03-15');

-- Palisades (e4): total raised = $2,800,000 = 280000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000201', NULL, 'Demetree Holdings LLC', 'entity', 100, 100.0000, 280000000, '2022-08-20');

-- Chem Derivatives (e5): total raised = $12,000,000 = 1200000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000202', NULL,                                    'Demetree Capital Partners LLC', 'entity',        4000, 40.0000,  480000000, '2023-02-14'),
  ('00000000-0000-0000-0000-000000000205', NULL,                                   '00000000-0000-0000-0000-000000000110',   'Greenfield Family Office',      'family_office',  3000, 30.0000,  360000000, '2023-02-14'),
  ('00000000-0000-0000-0000-000000000205', NULL,                                   '00000000-0000-0000-0000-000000000109',   'Coastal Ventures LP',           'external_fund',  2000, 20.0000,  240000000, '2023-03-01'),
  ('00000000-0000-0000-0000-000000000205', NULL,                                   '00000000-0000-0000-0000-000000000111',   'J. Harrison Trust',             'trust',          1000, 10.0000,  120000000, '2023-04-15');

-- Awary (e6): total raised = $150,000 = 15000000 cents
INSERT INTO cap_table_entries (entity_id, investor_entity_id, investor_directory_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date) VALUES
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000201', NULL,                                    'Demetree Holdings LLC', 'entity',     8000, 80.0000, 12000000, '2024-05-01'),
  ('00000000-0000-0000-0000-000000000206', NULL,                                   '00000000-0000-0000-0000-000000000101',   'Sean Demetree',         'individual', 2000, 20.0000,  3000000, '2024-05-01');

-- =============================================================================
-- 10. Custom Field Definitions + Values
-- =============================================================================
-- Each entity gets its own field definitions (is_global = false, entity_id set).
-- UUID range: ...0401 – ...0414

-- --- Holdings (e1): "Ridge Agreement" (checkbox, true), "Tax Counsel" (text, "Baker McKenzie") ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000401', 'Ridge Agreement', 'checkbox', false, '00000000-0000-0000-0000-000000000201', 1),
  ('00000000-0000-0000-0000-000000000402', 'Tax Counsel',     'text',     false, '00000000-0000-0000-0000-000000000201', 2);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean, value_text) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000401', true,  NULL),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000402', NULL,  'Baker McKenzie');

-- --- DCP (e2): "Ridge Agreement" (checkbox, true), "Fund Admin" (text, "Carta") ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000403', 'Ridge Agreement', 'checkbox', false, '00000000-0000-0000-0000-000000000202', 1),
  ('00000000-0000-0000-0000-000000000404', 'Fund Admin',      'text',     false, '00000000-0000-0000-0000-000000000202', 2);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean, value_text) VALUES
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000403', true,  NULL),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000404', NULL,  'Carta');

-- --- Tall Oil (e3): "Ridge Agreement" (checkbox, true), "Insurance Carrier" (text, "Hartford"), "Environmental Permit" (checkbox, true) ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000405', 'Ridge Agreement',      'checkbox', false, '00000000-0000-0000-0000-000000000203', 1),
  ('00000000-0000-0000-0000-000000000406', 'Insurance Carrier',    'text',     false, '00000000-0000-0000-0000-000000000203', 2),
  ('00000000-0000-0000-0000-000000000407', 'Environmental Permit', 'checkbox', false, '00000000-0000-0000-0000-000000000203', 3);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean, value_text) VALUES
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000405', true,  NULL),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000406', NULL,  'Hartford'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000407', true,  NULL);

-- --- Palisades (e4): "Ridge Agreement" (checkbox, false) ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000408', 'Ridge Agreement', 'checkbox', false, '00000000-0000-0000-0000-000000000204', 1);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean) VALUES
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000408', false);

-- --- Chem Derivatives (e5): "Ridge Agreement" (checkbox, true), "Fund Admin" (text, "Carta") ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000409', 'Ridge Agreement', 'checkbox', false, '00000000-0000-0000-0000-000000000205', 1),
  ('00000000-0000-0000-0000-000000000410', 'Fund Admin',      'text',     false, '00000000-0000-0000-0000-000000000205', 2);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean, value_text) VALUES
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000409', true,  NULL),
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000410', NULL,  'Carta');

-- --- Awary (e6): "Ridge Agreement" (checkbox, false), "Cloud Provider" (text, "AWS + GCP") ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000411', 'Ridge Agreement',  'checkbox', false, '00000000-0000-0000-0000-000000000206', 1),
  ('00000000-0000-0000-0000-000000000412', 'Cloud Provider',   'text',     false, '00000000-0000-0000-0000-000000000206', 2);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean, value_text) VALUES
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000411', false, NULL),
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000412', NULL,  'AWS + GCP');

-- --- Family Trust (e7): "Crummey Letters" (checkbox, true) ---
INSERT INTO custom_field_definitions (id, label, field_type, is_global, entity_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000413', 'Crummey Letters', 'checkbox', false, '00000000-0000-0000-0000-000000000207', 1);

INSERT INTO custom_field_values (entity_id, field_def_id, value_boolean) VALUES
  ('00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000413', true);

COMMIT;
