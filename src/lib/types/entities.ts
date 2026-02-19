import { EntityType, EntityStatus, Jurisdiction, TrustType, TrustRoleType, RelationshipType, PaymentFrequency, RelationshipStatus, InvestorType, CustomFieldType, FilingStatus, DocumentType } from './enums';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  status: EntityStatus;
  ein: string | null;
  formation_state: Jurisdiction;
  formed_date: string | null;
  address: string | null;
  registered_agent: string | null;
  parent_entity_id: string | null;
  notes: string | null;
  business_purpose: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityListItem extends Entity {
  registrations: EntityRegistration[];
  managers: EntityManager[];
  members: EntityMember[];
  filing_status: FilingStatus;
}

export interface EntityDetail extends Entity {
  registrations: EntityRegistration[];
  managers: EntityManager[];
  members: EntityMember[];
  partnership_reps: EntityPartnershipRep[];
  roles: EntityRole[];
  custom_fields: CustomFieldWithValue[];
  trust_details: TrustDetails | null;
  trust_roles: TrustRole[];
  relationships: Relationship[];
  cap_table: CapTableEntry[];
}

export interface EntityRegistration {
  id: string;
  entity_id: string;
  jurisdiction: Jurisdiction;
  qualification_date: string | null;
  last_filing_date: string | null;
  state_id: string | null;
  filing_exempt: boolean;
}

export interface EntityManager {
  id: string;
  entity_id: string;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

export interface EntityMember {
  id: string;
  entity_id: string;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

export interface EntityPartnershipRep {
  id: string;
  entity_id: string;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

export interface EntityRole {
  id: string;
  entity_id: string;
  role_title: string;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

export interface TrustDetails {
  id: string;
  entity_id: string;
  trust_type: TrustType;
  trust_date: string | null;
  grantor_name: string | null;
  situs_state: Jurisdiction | null;
}

export interface TrustRole {
  id: string;
  trust_detail_id: string;
  role: TrustRoleType;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  description: string;
  terms: string | null;
  from_entity_id: string | null;
  from_directory_id: string | null;
  to_entity_id: string | null;
  to_directory_id: string | null;
  frequency: PaymentFrequency;
  status: RelationshipStatus;
  effective_date: string | null;
  end_date: string | null;
  annual_estimate: number | null; // stored as bigint cents in DB
  from_name?: string;
  to_name?: string;
}

export interface CapTableEntry {
  id: string;
  entity_id: string;
  investor_entity_id: string | null;
  investor_directory_id: string | null;
  investor_name: string | null;
  investor_type: InvestorType;
  units: number | null;
  ownership_pct: number;
  capital_contributed: number; // bigint cents
  investment_date: string | null;
}

export interface CustomFieldDefinition {
  id: string;
  label: string;
  field_type: CustomFieldType;
  options: unknown | null;
  is_global: boolean;
  entity_id: string | null;
  sort_order: number;
}

export interface CustomFieldValue {
  id: string;
  entity_id: string;
  field_def_id: string;
  value_text: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_number: number | null;
}

export interface CustomFieldWithValue extends CustomFieldDefinition {
  value: CustomFieldValue | null;
}

export interface Document {
  id: string;
  entity_id: string;
  name: string;
  document_type: DocumentType;
  year: number | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  ai_extracted: boolean;
  ai_extraction: unknown | null;
  ai_extracted_at: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ProposedAction {
  action: 'create_entity' | 'update_entity' | 'create_relationship' | 'add_member' | 'add_manager' | 'add_registration' | 'add_trust_role' | 'update_cap_table' | 'create_directory_entry' | 'add_custom_field' | 'add_partnership_rep' | 'add_role';
  data: Record<string, unknown>;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}
