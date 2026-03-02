/**
 * Filename-based document classifier.
 * Provides instant heuristic classification before AI extraction.
 */

export interface ClassificationResult {
  document_type: string | null;
  category: string | null;
  entity_hint: string | null;
  year: number | null;
  confidence: 'high' | 'medium' | 'low';
  direction: 'issued' | 'received' | null;
  is_composite: boolean;
}

interface PatternRule {
  pattern: RegExp;
  type: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  direction?: 'issued' | 'received' | null;
  composite?: boolean;
}

const PATTERNS: PatternRule[] = [
  // Formation
  { pattern: /operating\s*agree/i, type: 'operating_agreement', category: 'formation', confidence: 'high' },
  { pattern: /amended\s*(operating\s*agree|oa\b)/i, type: 'amended_operating_agreement', category: 'formation', confidence: 'high' },
  { pattern: /cert(ificate)?\s*(of\s*)?form(ation)?/i, type: 'certificate_of_formation', category: 'formation', confidence: 'high' },
  { pattern: /articles?\s*(of\s*)?incorp/i, type: 'articles_of_incorporation', category: 'formation', confidence: 'high' },
  { pattern: /articles?\s*(of\s*)?org/i, type: 'articles_of_organization', category: 'formation', confidence: 'high' },
  { pattern: /bylaws/i, type: 'bylaws', category: 'formation', confidence: 'high' },
  { pattern: /partnership\s*agree/i, type: 'partnership_agreement', category: 'formation', confidence: 'high' },
  { pattern: /trust\s*agree/i, type: 'trust_agreement', category: 'formation', confidence: 'high' },
  { pattern: /trust\s*amend/i, type: 'trust_amendment', category: 'formation', confidence: 'high' },

  // Tax
  { pattern: /ein\s*(letter|confirmation|notice)/i, type: 'ein_letter', category: 'tax', confidence: 'high' },
  { pattern: /\b1065\b/i, type: 'tax_return_1065', category: 'tax', confidence: 'high' },
  { pattern: /\b1120[\s-]?s\b/i, type: 'tax_return_1120s', category: 'tax', confidence: 'high' },
  { pattern: /\b1041\b/i, type: 'tax_return_1041', category: 'tax', confidence: 'high' },
  { pattern: /\b1040\b/i, type: 'tax_return_1040', category: 'tax', confidence: 'medium' },
  { pattern: /\bk[\s-]?1\b/i, type: 'k1', category: 'tax', confidence: 'high', direction: 'received' },
  { pattern: /\bw[\s-]?9\b/i, type: 'w9', category: 'tax', confidence: 'high' },
  { pattern: /\bw[\s-]?8\s*ben/i, type: 'w8ben', category: 'tax', confidence: 'high' },
  { pattern: /\b(ca|california)\s*(form\s*)?3522\b/i, type: 'ca_form_3522', category: 'tax', confidence: 'high' },
  { pattern: /\b(ca|california)\s*(form\s*)?3536\b/i, type: 'ca_form_3536', category: 'tax', confidence: 'high' },
  { pattern: /\b(ca|california)\s*(form\s*)?100[\s-]?es\b/i, type: 'ca_form_100es', category: 'tax', confidence: 'high' },
  { pattern: /franchise\s*tax|state\s*tax\s*pay/i, type: 'franchise_tax_payment', category: 'tax', confidence: 'medium' },
  { pattern: /tax\s*(return|filing)s?\b/i, type: 'tax_return_1065', category: 'tax', confidence: 'low' },
  { pattern: /tax\s*package/i, type: 'tax_package', category: 'tax', confidence: 'high', composite: true },

  // Investor
  { pattern: /subscription\s*agree/i, type: 'subscription_agreement', category: 'investor', confidence: 'high' },
  { pattern: /capital\s*call/i, type: 'capital_call_notice', category: 'investor', confidence: 'high', direction: 'issued' },
  { pattern: /distribution\s*notice/i, type: 'distribution_notice', category: 'investor', confidence: 'high', direction: 'issued' },
  { pattern: /investor\s*quest/i, type: 'investor_questionnaire', category: 'investor', confidence: 'high' },
  { pattern: /side\s*letter/i, type: 'side_letter', category: 'investor', confidence: 'high' },
  { pattern: /\bppm\b|private\s*placement/i, type: 'ppm', category: 'investor', confidence: 'high' },
  { pattern: /cap\s*table/i, type: 'cap_table', category: 'investor', confidence: 'high' },

  // Contracts
  { pattern: /management\s*agree/i, type: 'management_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /advisory\s*agree/i, type: 'advisory_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /consulting\s*agree/i, type: 'consulting_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /service\s*agree/i, type: 'service_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /license\s*agree/i, type: 'license_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /lease\s*agree/i, type: 'lease_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /promissory\s*note/i, type: 'promissory_note', category: 'contracts', confidence: 'high' },
  { pattern: /loan\s*agree/i, type: 'loan_agreement', category: 'contracts', confidence: 'high' },
  { pattern: /\bguarantee?\b/i, type: 'guarantee', category: 'contracts', confidence: 'medium' },
  { pattern: /\bassignment\b/i, type: 'assignment', category: 'contracts', confidence: 'medium' },

  // Compliance
  { pattern: /annual\s*report/i, type: 'annual_report', category: 'compliance', confidence: 'high', direction: 'issued' },
  { pattern: /statement\s*(of\s*)?info/i, type: 'statement_of_information', category: 'compliance', confidence: 'high', direction: 'issued' },
  { pattern: /good\s*standing/i, type: 'certificate_of_good_standing', category: 'compliance', confidence: 'high', direction: 'received' },
  { pattern: /foreign\s*qual/i, type: 'foreign_qualification', category: 'compliance', confidence: 'high' },
  { pattern: /registered\s*agent/i, type: 'registered_agent_appointment', category: 'compliance', confidence: 'medium' },

  // Insurance
  { pattern: /cert(ificate)?\s*(of\s*)?ins(urance)?/i, type: 'certificate_of_insurance', category: 'insurance', confidence: 'high', direction: 'received' },
  { pattern: /insurance\s*polic/i, type: 'insurance_policy', category: 'insurance', confidence: 'high', direction: 'received' },
  { pattern: /\b(general\s*)?liability\s*insurance/i, type: 'insurance_policy', category: 'insurance', confidence: 'high', direction: 'received' },
  { pattern: /\b(d&o|directors?\s*(and|&)\s*officers?)\s*(insurance|polic)/i, type: 'insurance_policy', category: 'insurance', confidence: 'high', direction: 'received' },

  // Governance
  { pattern: /board\s*resol/i, type: 'board_resolution', category: 'governance', confidence: 'high' },
  { pattern: /(unanimous\s*)?written\s*consent/i, type: 'consent_of_members', category: 'governance', confidence: 'high' },
  { pattern: /consent\s*(of\s*)?(members?|managers?)/i, type: 'consent_of_members', category: 'governance', confidence: 'high' },
  { pattern: /meeting\s*minutes/i, type: 'meeting_minutes', category: 'governance', confidence: 'high' },
  { pattern: /power\s*(of\s*)?attorney|poa/i, type: 'power_of_attorney', category: 'governance', confidence: 'high' },

  // Other
  { pattern: /payment\s*confirm/i, type: 'payment_confirmation', category: 'other', confidence: 'medium', direction: 'issued' },
  { pattern: /business\s*license/i, type: 'business_license_receipt', category: 'other', confidence: 'medium' },
];

/**
 * Extract a 4-digit year from a filename.
 */
function extractYear(filename: string): number | null {
  // Try "FY2024", "FY 2024" patterns first
  const fyMatch = filename.match(/\bFY\s*(\d{4})\b/i);
  if (fyMatch) return parseInt(fyMatch[1], 10);

  // Try standalone 4-digit year (2010-2039 range to avoid matching other numbers)
  const yearMatch = filename.match(/\b(20[1-3]\d)\b/);
  if (yearMatch) return parseInt(yearMatch[1], 10);

  return null;
}

/**
 * Extract an entity name hint from a filename.
 * Looks for patterns like "Entity Name - Document Type" or "Document Type - Entity Name".
 */
function extractEntityHint(filename: string): string | null {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, '');

  // Common separators: " - ", " – ", " _ "
  const parts = name.split(/\s*[-–_]\s*/);

  if (parts.length < 2) return null;

  // Filter out parts that look like document types, years, or generic labels
  const typePatterns = /^(k[\s-]?1|w[\s-]?[489]|w8ben|1065|1120s?|1041|1040|tax|annual|cert(ificate)?|operating|trust|fy\s*\d{4}|\d{4}|form\s*\d+|q[1-4]|amended|oa)$/i;
  const phrasePatterns = /^(operating\s*agreement|certificate\s*of\s*(formation|good\s*standing|insurance)|annual\s*report(\s*\d{4})?|tax\s*(return|package)|board\s*resolution|meeting\s*minutes|subscription\s*agreement|capital\s*call\s*notice|distribution\s*notice|loan\s*agreement|lease\s*agreement|insurance\s*(certificate|policy)|general\s*liability\s*insurance|power\s*of\s*attorney|written\s*consent|ein\s*letter|ss4\s*confirmation|annual\s*meeting\s*\d{4}|lp\s*interest|q[1-4]\s*\d{4})$/i;
  const candidates = parts.filter((p) => {
    const t = p.trim();
    return t.length > 2 && !typePatterns.test(t) && !phrasePatterns.test(t);
  });

  if (candidates.length === 0) return null;

  // The longest candidate that looks like a name (contains spaces or capital letters)
  const best = candidates
    .filter((c) => /[A-Z]/.test(c) || c.includes(' '))
    .sort((a, b) => b.length - a.length)[0];

  return best?.trim() || candidates[0]?.trim() || null;
}

/**
 * Classify a document by its filename using regex heuristics.
 */
export function classifyByFilename(filename: string): ClassificationResult {
  const result: ClassificationResult = {
    document_type: null,
    category: null,
    entity_hint: null,
    year: null,
    confidence: 'low',
    direction: null,
    is_composite: false,
  };

  // Extract year
  result.year = extractYear(filename);

  // Extract entity hint
  result.entity_hint = extractEntityHint(filename);

  // Match against patterns
  for (const rule of PATTERNS) {
    if (rule.pattern.test(filename)) {
      result.document_type = rule.type;
      result.category = rule.category;
      result.confidence = rule.confidence;
      result.direction = rule.direction || null;
      result.is_composite = rule.composite || false;
      break;
    }
  }

  return result;
}

/**
 * Try to match an entity hint to an existing entity by name.
 * Uses case-insensitive substring matching.
 */
export function matchEntityByHint(
  hint: string | null,
  entities: Array<{ id: string; name: string; short_name: string | null }>
): { id: string; name: string } | null {
  if (!hint) return null;

  const normalizedHint = hint.toLowerCase().trim();

  // Exact match on short_name
  for (const e of entities) {
    if (e.short_name && e.short_name.toLowerCase() === normalizedHint) {
      return { id: e.id, name: e.name };
    }
  }

  // Exact match on name
  for (const e of entities) {
    if (e.name.toLowerCase() === normalizedHint) {
      return { id: e.id, name: e.name };
    }
  }

  // Substring match — hint appears in entity name
  for (const e of entities) {
    if (e.name.toLowerCase().includes(normalizedHint)) {
      return { id: e.id, name: e.name };
    }
  }

  // Substring match — entity name appears in hint
  for (const e of entities) {
    if (normalizedHint.includes(e.name.toLowerCase())) {
      return { id: e.id, name: e.name };
    }
  }

  // Short name substring match
  for (const e of entities) {
    if (e.short_name && normalizedHint.includes(e.short_name.toLowerCase())) {
      return { id: e.id, name: e.name };
    }
  }

  return null;
}

/**
 * Guess the direction (issued/received) from filename and doc type.
 */
export function guessDirection(
  filename: string,
  docType: string | null
): 'issued' | 'received' | null {
  // Check filename for explicit direction indicators
  if (/\b(sent|issued|outgoing|filed)\b/i.test(filename)) return 'issued';
  if (/\b(received|incoming|from)\b/i.test(filename)) return 'received';

  // Infer from document type
  const issuedTypes = ['annual_report', 'statement_of_information', 'capital_call_notice', 'distribution_notice', 'payment_confirmation'];
  const receivedTypes = ['k1', 'certificate_of_good_standing', 'certificate_of_insurance', 'insurance_policy', 'ein_letter'];

  if (docType && issuedTypes.includes(docType)) return 'issued';
  if (docType && receivedTypes.includes(docType)) return 'received';

  return null;
}
