import { EntityType, EntityStatus, Jurisdiction, TrustType, TrustRoleType, RelationshipType, PaymentFrequency, RelationshipStatus, InvestorType, CustomFieldType, FilingStatus, DocumentType, LegalStructure, QueueStatus, BatchStatus, BatchContext } from './enums';

export interface Entity {
  id: string;
  name: string;
  short_name: string | null;
  type: EntityType;
  status: EntityStatus;
  ein: string | null;
  formation_state: Jurisdiction;
  formed_date: string | null;
  address: string | null;
  registered_agent: string | null;
  parent_entity_id: string | null;
  legal_structure: LegalStructure | null;
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
  compliance_obligations: ComplianceObligation[];
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

export type DocumentCategory = 'formation' | 'tax' | 'investor' | 'contracts' | 'compliance' | 'insurance' | 'governance' | 'other';

export interface Document {
  id: string;
  entity_id: string | null;
  name: string;
  document_type: DocumentType;
  document_category: DocumentCategory | null;
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
  content_hash: string | null;
  jurisdiction: string | null;
  direction: string | null;
  source_page_range: number[] | null;
  source_document_id: string | null;
  k1_recipient: string | null;
  created_at: string;
  link_role?: string | null;  // Set when doc is linked via document_entity_links (not direct entity_id)
}

// --- Pipeline types ---

export interface DocumentTypeRecord {
  id: string;
  slug: string;
  label: string;
  short_label: string | null;
  category: string;
  description: string | null;
  jurisdiction: string | null;
  form_number: string | null;
  is_seed: boolean;
  is_active: boolean;
  usage_count: number;
  created_at: string;
}

export interface QueueItem {
  id: string;
  batch_id: string;
  status: QueueStatus;
  original_filename: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  content_hash: string | null;

  // Staging
  staged_doc_type: string | null;
  staged_entity_id: string | null;
  staged_entity_name: string | null;
  staged_year: number | null;
  staged_category: string | null;
  staging_confidence: string | null;
  user_corrected: boolean;

  // AI extraction
  ai_extraction: unknown | null;
  ai_summary: string | null;
  ai_document_type: string | null;
  ai_document_category: string | null;
  ai_entity_id: string | null;
  ai_year: number | null;
  ai_confidence: number | null;
  ai_proposed_actions: ProposedAction[] | null;
  ai_direction: string | null;
  ai_proposed_entity: Record<string, unknown> | null;
  ai_proposed_entities: Array<Record<string, unknown>> | null;
  ai_related_entities: Array<{
    entity_id: string;
    entity_name: string;
    role: string;
    confidence: string;
    reason: string;
  }> | null;

  // Composite
  is_composite: boolean;
  parent_queue_id: string | null;
  ai_jurisdiction: string | null;
  ai_page_range: number[] | null;
  ai_k1_recipient: string | null;
  ai_suggested_name: string | null;

  // Processing
  extraction_started_at: string | null;
  extraction_completed_at: string | null;
  extraction_error: string | null;
  extraction_tokens: number | null;
  pdf_page_count: number | null;
  pdf_tier: string | null;

  // Auto-ingest routing
  approval_reason: string | null;
  entity_match_confidence: string | null;

  // Review
  reviewed_by: string | null;
  reviewed_at: string | null;

  // Result
  document_id: string | null;

  source_type: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentBatch {
  id: string;
  name: string | null;
  source_type: string;
  status: BatchStatus;
  context: BatchContext;
  entity_id: string | null;
  entity_discovery: boolean;

  total_documents: number;
  staged_count: number;
  queued_count: number;
  extracted_count: number;
  approved_count: number;
  rejected_count: number;
  error_count: number;
  new_entities_proposed: number;
  new_entities_created: number;

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ComplianceStatus = 'pending' | 'completed' | 'overdue' | 'exempt' | 'not_applicable';

export interface ComplianceObligation {
  id: string;
  entity_id: string;
  rule_id: string;
  jurisdiction: string;
  obligation_type: string;
  name: string;
  description: string | null;
  frequency: string;
  next_due_date: string | null;
  status: ComplianceStatus;
  completed_at: string | null;
  completed_by: string | null;
  document_id: string | null;
  payment_amount: number | null;
  confirmation: string | null;
  notes: string | null;
  fee_description: string | null;
  form_number: string | null;
  portal_url: string | null;
  filed_with: string | null;
  penalty_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposedAction {
  action: 'create_entity' | 'update_entity' | 'create_relationship' | 'add_member' | 'add_manager' | 'add_registration' | 'add_trust_role' | 'update_cap_table' | 'create_directory_entry' | 'add_custom_field' | 'add_partnership_rep' | 'add_role' | 'complete_obligation' | 'update_obligation';
  data: Record<string, unknown>;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}
