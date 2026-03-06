export type EntityType = 'holding_company' | 'investment_fund' | 'operating_company' | 'real_estate' | 'special_purpose' | 'management_company' | 'trust' | 'other';
export type LegalStructure = 'llc' | 'corporation' | 'lp' | 'trust' | 'gp' | 'sole_prop' | 'series_llc' | 'other';
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

export type QueueStatus = 'uploaded' | 'staged' | 'queued' | 'extracting' | 'extracted' | 'review_ready' | 'approved' | 'rejected' | 'error';
export type BatchStatus = 'staging' | 'processing' | 'review' | 'completed';
export type BatchContext = 'global' | 'entity' | 'onboarding';
