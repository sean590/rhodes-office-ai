export type EntityType = 'holding_company' | 'investment_fund' | 'operating_company' | 'real_estate' | 'special_purpose' | 'management_company' | 'trust' | 'other';
export type EntityStatus = 'active' | 'inactive' | 'dissolved' | 'suspended' | 'pending_formation' | 'converting';
export type TrustType = 'revocable' | 'irrevocable';
export type TrustRoleType = 'grantor' | 'trustee' | 'successor_trustee' | 'beneficiary' | 'contingent_beneficiary' | 'trust_protector' | 'enforcer' | 'investment_advisor' | 'distribution_advisor' | 'trust_counsel';
export type DirectoryEntryType = 'individual' | 'external_entity' | 'trust';
export type Jurisdiction = 'AL'|'AK'|'AZ'|'AR'|'CA'|'CO'|'CT'|'DE'|'DC'|'FL'|'GA'|'HI'|'ID'|'IL'|'IN'|'IA'|'KS'|'KY'|'LA'|'ME'|'MD'|'MA'|'MI'|'MN'|'MS'|'MO'|'MT'|'NE'|'NV'|'NH'|'NJ'|'NM'|'NY'|'NC'|'ND'|'OH'|'OK'|'OR'|'PA'|'RI'|'SC'|'SD'|'TN'|'TX'|'UT'|'VT'|'VA'|'WA'|'WV'|'WI'|'WY'|'PR'|'GU'|'VI'|'AS'|'foreign';
export type RelationshipType = 'profit_share' | 'fixed_fee' | 'management_fee' | 'performance_fee' | 'equity' | 'loan' | 'guarantee' | 'service_agreement' | 'license' | 'lease' | 'other';
export type PaymentFrequency = 'one_time' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'upon_event' | 'na';
export type RelationshipStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'disputed';
export type InvestorType = 'individual' | 'entity' | 'external_fund' | 'family_office' | 'institutional' | 'trust' | 'other';
export type FilingType = 'annual_report' | 'biennial_report' | 'statement_of_information' | 'franchise_tax' | 'annual_list' | 'periodic_report' | 'foreign_qualification_renewal' | 'other';
export type FilingStatus = 'current' | 'due_soon' | 'overdue' | 'not_required' | 'exempt';
export type CustomFieldType = 'text' | 'checkbox' | 'date' | 'number' | 'dropdown' | 'url';
export type UserRole = 'admin' | 'editor' | 'viewer';

export type DocumentType =
  | 'operating_agreement' | 'amended_operating_agreement' | 'certificate_of_formation'
  | 'articles_of_incorporation' | 'articles_of_organization' | 'bylaws'
  | 'partnership_agreement' | 'trust_agreement' | 'trust_amendment'
  | 'ein_letter' | 'tax_return_1065' | 'tax_return_1120s' | 'tax_return_1041'
  | 'tax_return_1040' | 'k1' | 'w9' | 'w8ben'
  | 'ca_form_3522' | 'ca_form_3536' | 'ca_form_100es'
  | 'franchise_tax_payment'
  | 'subscription_agreement' | 'capital_call_notice' | 'distribution_notice'
  | 'investor_questionnaire' | 'side_letter' | 'ppm' | 'cap_table'
  | 'management_agreement' | 'advisory_agreement' | 'consulting_agreement'
  | 'service_agreement' | 'license_agreement' | 'lease_agreement' | 'promissory_note'
  | 'loan_agreement' | 'guarantee' | 'assignment' | 'amendment'
  | 'annual_report' | 'statement_of_information' | 'certificate_of_good_standing'
  | 'foreign_qualification' | 'registered_agent_appointment'
  | 'certificate_of_insurance' | 'insurance_policy'
  | 'board_resolution' | 'consent_of_members' | 'meeting_minutes'
  | 'power_of_attorney' | 'other';
