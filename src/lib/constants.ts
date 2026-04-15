import { Jurisdiction, TrustRoleType } from './types/enums';
import type { DocumentCategory, Document } from './types/entities';

export const US_STATES: { value: Jurisdiction; label: string }[] = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' }, { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' }, { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' }, { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
];

export const TRUST_ROLE_ORDER: TrustRoleType[] = [
  'grantor', 'trustee', 'successor_trustee', 'beneficiary', 'contingent_beneficiary',
  'trust_protector', 'enforcer', 'investment_advisor', 'distribution_advisor', 'trust_counsel',
];

export const TRUST_ROLE_LABELS: Record<TrustRoleType, string> = {
  grantor: 'Grantor',
  trustee: 'Trustee',
  successor_trustee: 'Successor Trustee',
  beneficiary: 'Beneficiary',
  contingent_beneficiary: 'Contingent Beneficiary',
  trust_protector: 'Trust Protector',
  enforcer: 'Enforcer',
  investment_advisor: 'Investment Advisor',
  distribution_advisor: 'Distribution Advisor',
  trust_counsel: 'Trust Counsel',
};

export const TRUST_ROLE_COLORS: Record<TrustRoleType, string> = {
  grantor: '#2d5a3d',
  trustee: '#3366a8',
  successor_trustee: '#5a8ab5',
  beneficiary: '#7b4db5',
  contingent_beneficiary: '#9470c0',
  trust_protector: '#c47520',
  enforcer: '#c73e3e',
  investment_advisor: '#2d8a4e',
  distribution_advisor: '#2a8a6a',
  trust_counsel: '#8a6040',
};

export function getStateLabel(code: Jurisdiction): string {
  return US_STATES.find(s => s.value === code)?.label || code;
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  operating_agreement: 'Operating Agreement',
  amended_operating_agreement: 'Amended Operating Agreement',
  certificate_of_formation: 'Certificate of Formation',
  articles_of_incorporation: 'Articles of Incorporation',
  articles_of_organization: 'Articles of Organization',
  bylaws: 'Bylaws',
  partnership_agreement: 'Partnership Agreement',
  trust_agreement: 'Trust Agreement',
  trust_amendment: 'Trust Amendment',
  ein_letter: 'EIN Letter',
  tax_return_1065: 'Tax Return (1065)',
  tax_return_1120s: 'Tax Return (1120-S)',
  tax_return_1041: 'Tax Return (1041)',
  tax_return_1040: 'Tax Return (1040)',
  k1: 'K-1',
  w9: 'W-9',
  w8ben: 'W-8BEN',
  ca_form_3522: 'CA Form 3522 (LLC Tax Voucher)',
  ca_form_3536: 'CA Form 3536 (Estimated Fee)',
  ca_form_100es: 'CA Form 100-ES (Estimated Tax)',
  franchise_tax_payment: 'State Tax Payment',
  subscription_agreement: 'Subscription Agreement',
  capital_call_notice: 'Capital Call Notice',
  distribution_notice: 'Distribution Notice',
  investor_questionnaire: 'Investor Questionnaire',
  side_letter: 'Side Letter',
  ppm: 'Private Placement Memorandum',
  cap_table: 'Cap Table',
  management_agreement: 'Management Agreement',
  advisory_agreement: 'Advisory Agreement',
  consulting_agreement: 'Consulting Agreement',
  service_agreement: 'Service Agreement',
  license_agreement: 'License Agreement',
  lease_agreement: 'Lease Agreement',
  promissory_note: 'Promissory Note',
  loan_agreement: 'Loan Agreement',
  guarantee: 'Guarantee',
  assignment: 'Assignment',
  amendment: 'Amendment',
  annual_report: 'Annual Report',
  statement_of_information: 'Statement of Information',
  certificate_of_good_standing: 'Certificate of Good Standing',
  foreign_qualification: 'Foreign Qualification',
  registered_agent_appointment: 'Registered Agent Appointment',
  certificate_of_insurance: 'Certificate of Insurance',
  insurance_policy: 'Insurance Policy',
  board_resolution: 'Board Resolution',
  consent_of_members: 'Consent of Members',
  meeting_minutes: 'Meeting Minutes',
  power_of_attorney: 'Power of Attorney',
  payment_confirmation: 'Payment Confirmation',
  business_license_receipt: 'Business License Receipt',
  tax_package: 'Tax Package',
  state_tax_payment: 'State Tax Payment',
  ca_form_3588: 'CA Form 3588 (Payment Voucher)',
  investment_correspondence: 'Investment Correspondence',
  investment_summary: 'Investment Summary',
  distribution_summary: 'Distribution Summary',
  other: 'Other',
};

export const DOCUMENT_CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: 'formation', label: 'Formation' },
  { value: 'tax', label: 'Tax' },
  { value: 'investor', label: 'Investor' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'governance', label: 'Governance' },
  { value: 'other', label: 'Other' },
];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  formation: 'Formation',
  tax: 'Tax',
  investor: 'Investor',
  contracts: 'Contracts',
  compliance: 'Compliance',
  insurance: 'Insurance',
  governance: 'Governance',
  other: 'Other',
};

export const DOCUMENT_TYPE_CATEGORIES: Record<string, { label: string; types: string[] }> = {
  formation: {
    label: 'Formation',
    types: ['operating_agreement', 'amended_operating_agreement', 'certificate_of_formation', 'articles_of_incorporation', 'articles_of_organization', 'bylaws', 'partnership_agreement', 'trust_agreement', 'trust_amendment'],
  },
  tax: {
    label: 'Tax',
    types: ['ein_letter', 'tax_return_1065', 'tax_return_1120s', 'tax_return_1041', 'tax_return_1040', 'tax_package', 'k1', 'w9', 'w8ben', 'ca_form_3522', 'ca_form_3536', 'ca_form_100es', 'ca_form_3588', 'franchise_tax_payment', 'state_tax_payment'],
  },
  investor: {
    label: 'Investor',
    types: ['subscription_agreement', 'capital_call_notice', 'distribution_notice', 'investor_questionnaire', 'side_letter', 'ppm', 'cap_table'],
  },
  contracts: {
    label: 'Contracts',
    types: ['management_agreement', 'advisory_agreement', 'consulting_agreement', 'service_agreement', 'license_agreement', 'lease_agreement', 'promissory_note', 'loan_agreement', 'guarantee', 'assignment', 'amendment'],
  },
  compliance: {
    label: 'Compliance',
    types: ['annual_report', 'statement_of_information', 'certificate_of_good_standing', 'foreign_qualification', 'registered_agent_appointment'],
  },
  insurance: {
    label: 'Insurance',
    types: ['certificate_of_insurance', 'insurance_policy'],
  },
  governance: {
    label: 'Governance',
    types: ['board_resolution', 'consent_of_members', 'meeting_minutes', 'power_of_attorney'],
  },
  other: {
    label: 'Other',
    types: ['other'],
  },
};

/* ---- Tax Sub-Grouping ---- */

export const TAX_SUB_GROUP_BUCKETS: Array<{
  key: string;
  label: string;
  labelFn?: (jurisdiction: string) => string;
  types: string[];
  splitByJurisdiction?: boolean;
  sortOrder: number;
}> = [
  {
    key: 'tax_returns',
    label: 'Tax Returns',
    types: ['tax_return_1065', 'tax_return_1120s', 'tax_return_1041', 'tax_return_1040', 'tax_package'],
    sortOrder: 1,
  },
  {
    key: 'k1',
    label: 'K-1s',
    labelFn: (jurisdiction) => jurisdiction === 'Federal' ? 'Federal K-1s' : `${jurisdiction} K-1s`,
    types: ['k1'],
    splitByJurisdiction: true,
    sortOrder: 2,
  },
  {
    key: 'state_forms',
    label: 'State Forms',
    types: ['ca_form_568', 'ca_form_3522', 'ca_form_3536', 'ca_form_100es', 'ca_form_3588'],
    sortOrder: 3,
  },
  {
    key: 'tax_payments',
    label: 'State Tax Payments',
    types: ['franchise_tax_payment', 'state_tax_payment'],
    sortOrder: 4,
  },
  {
    key: 'tax_id',
    label: 'Tax ID & Forms',
    types: ['ein_letter', 'w9', 'w8ben'],
    sortOrder: 5,
  },
  {
    key: 'other_tax',
    label: 'Other Tax',
    types: [],
    sortOrder: 99,
  },
];

export function getK1Jurisdiction(doc: Document): string {
  if (doc.jurisdiction) {
    return doc.jurisdiction.toLowerCase() === 'federal' ? 'Federal' : doc.jurisdiction;
  }
  const name = doc.name?.toLowerCase() || '';
  if (name.includes('federal')) return 'Federal';
  if (name.includes('california') || name.includes(' ca ')) return 'California';
  if (name.includes('delaware') || name.includes(' de ')) return 'Delaware';
  if (name.includes('nevada') || name.includes(' nv ')) return 'Nevada';
  if (name.includes('texas') || name.includes(' tx ')) return 'Texas';
  if (name.includes('new york') || name.includes(' ny ')) return 'New York';
  if (name.includes('florida') || name.includes(' fl ')) return 'Florida';
  if (name.includes('state')) return 'State';
  return 'Other';
}

export interface TaxSubGroup {
  year: number | null;
  bucketKey: string;
  bucketLabel: string;
  docs: Document[];
  sortOrder: number;
  jurisdictionSortKey?: string;
}

export function groupTaxDocuments(docs: Document[]): Map<number | null, TaxSubGroup[]> {
  // 1. Group by year
  const byYear = new Map<number | null, Document[]>();
  for (const doc of docs) {
    const year = doc.year ?? null;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(doc);
  }

  // 2. Within each year, group by type bucket
  const result = new Map<number | null, TaxSubGroup[]>();

  for (const [year, yearDocs] of byYear) {
    const subGroups: TaxSubGroup[] = [];

    for (const bucket of TAX_SUB_GROUP_BUCKETS) {
      if (bucket.key === 'other_tax') continue; // handled below as catch-all
      const matching = yearDocs.filter(d => bucket.types.includes(d.document_type));

      if (bucket.splitByJurisdiction && bucket.key === 'k1') {
        const byJurisdiction = new Map<string, Document[]>();
        for (const doc of matching) {
          const j = getK1Jurisdiction(doc);
          if (!byJurisdiction.has(j)) byJurisdiction.set(j, []);
          byJurisdiction.get(j)!.push(doc);
        }
        for (const [jurisdiction, jDocs] of byJurisdiction) {
          subGroups.push({
            year,
            bucketKey: `k1_${jurisdiction.toLowerCase()}`,
            bucketLabel: bucket.labelFn ? bucket.labelFn(jurisdiction) : `${jurisdiction} K-1s`,
            docs: jDocs.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
            sortOrder: bucket.sortOrder,
            jurisdictionSortKey: jurisdiction === 'Federal' ? '0' : jurisdiction,
          });
        }
      } else if (matching.length > 0) {
        subGroups.push({
          year,
          bucketKey: bucket.key,
          bucketLabel: bucket.label,
          docs: matching.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
          sortOrder: bucket.sortOrder,
        });
      }
    }

    // Catch-all: any tax docs not matched by any bucket
    const matchedIds = new Set(subGroups.flatMap(sg => sg.docs.map(d => d.id)));
    const unmatched = yearDocs.filter(d => !matchedIds.has(d.id));
    if (unmatched.length > 0) {
      subGroups.push({
        year,
        bucketKey: 'other_tax',
        bucketLabel: 'Other Tax',
        docs: unmatched.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        sortOrder: 99,
      });
    }

    // Sort sub-groups by sortOrder, then jurisdictionSortKey
    subGroups.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.jurisdictionSortKey || '').localeCompare(b.jurisdictionSortKey || '');
    });

    result.set(year, subGroups);
  }

  return result;
}
