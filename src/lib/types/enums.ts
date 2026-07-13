export type EntityType = 'holding_company' | 'investment_fund' | 'operating_company' | 'real_estate' | 'special_purpose' | 'management_company' | 'trust' | 'person' | 'joint_title' | 'other';
export type LegalStructure = 'llc' | 'corporation' | 'lp' | 'trust' | 'grantor_trust' | 'non_grantor_trust' | 'gp' | 'sole_prop' | 'other';

// IRS tax election. Drives federal compliance rule matching alongside
// LegalStructure (which drives state rule matching). An LLC can be taxed as
// any of partnership/s_corp/c_corp/disregarded — that's why this is separate.
//
// Naming note: trust_grantor / trust_non_grantor here mirror IRS conventions
// for the *tax* election; LegalStructure uses grantor_trust / non_grantor_trust
// for the *legal* form. Different concepts; the leading-vs-trailing word order
// keeps them grep-distinct.
export type TaxClassification =
  | 'partnership'        // Form 1065 — multi-member LLCs (default), LPs, GPs
  | 's_corp'             // Form 1120-S — LLCs/corps with S election
  | 'c_corp'             // Form 1120 — corporations (default), LLCs that elected C corp
  | 'disregarded'        // No separate return — single-member LLCs (reported on owner's 1040)
  | 'sole_prop'          // Schedule C on owner's 1040; default for person entities
  | 'trust_grantor'      // Form 1041 (often optional); income on grantor's return
  | 'trust_non_grantor'  // Form 1041; trust is the taxpayer
  | 'tax_exempt';        // Form 990 — 501(c) organizations
export type EntityStatus = 'active' | 'inactive' | 'dissolved' | 'suspended' | 'pending_formation' | 'converting';
export type TrustType = 'revocable' | 'irrevocable';
export type TrustRoleType = 'grantor' | 'trustee' | 'successor_trustee' | 'beneficiary' | 'contingent_beneficiary' | 'trust_protector' | 'enforcer' | 'investment_advisor' | 'distribution_advisor' | 'trust_counsel';
export type DirectoryEntryType = 'individual' | 'external_entity' | 'trust';
export type Jurisdiction = 'AL'|'AK'|'AZ'|'AR'|'CA'|'CO'|'CT'|'DE'|'DC'|'FL'|'GA'|'HI'|'ID'|'IL'|'IN'|'IA'|'KS'|'KY'|'LA'|'ME'|'MD'|'MA'|'MI'|'MN'|'MS'|'MO'|'MT'|'NE'|'NV'|'NH'|'NJ'|'NM'|'NY'|'NC'|'ND'|'OH'|'OK'|'OR'|'PA'|'RI'|'SC'|'SD'|'TN'|'TX'|'UT'|'VT'|'VA'|'WA'|'WV'|'WI'|'WY'|'PR'|'GU'|'VI'|'AS'|'foreign';
export type RelationshipType = 'profit_share' | 'fixed_fee' | 'management_fee' | 'performance_fee' | 'equity' | 'loan' | 'guarantee' | 'service_agreement' | 'license' | 'lease' | 'other';
export type PaymentFrequency = 'one_time' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'upon_event' | 'na';
export type RelationshipStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'disputed';
export type InvestorType = 'individual' | 'entity' | 'external_fund' | 'family_office' | 'institutional' | 'trust' | 'other';
export type FilingType = 'annual_report' | 'biennial_report' | 'statement_of_information' | 'franchise_tax' | 'annual_list' | 'periodic_report' | 'foreign_qualification_renewal' | 'business_license' | 'publication' | 'registered_agent' | 'estimated_fee' | 'commerce_tax' | 'information_report' | 'decennial_report' | 'business_entity_tax' | 'statement_of_info' | 'other';
export type FilingStatus = 'current' | 'due_soon' | 'overdue' | 'not_required' | 'exempt';
export type CustomFieldType = 'text' | 'checkbox' | 'date' | 'number' | 'dropdown' | 'url';
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

// Document types are now database-driven (document_types table).
// This is a plain string to allow dynamic types created by AI.
export type DocumentType = string;

export type QueueStatus = 'uploaded' | 'staged' | 'queued' | 'extracting' | 'extracted' | 'review_ready' | 'approved' | 'rejected' | 'error' | 'password_required';
export type BatchStatus = 'staging' | 'processing' | 'review' | 'completed';
export type BatchContext = 'global' | 'entity' | 'onboarding';
