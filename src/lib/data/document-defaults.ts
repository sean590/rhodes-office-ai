/**
 * Document defaults + scope mapping. No server-only deps so this can be
 * imported from both the engine (document-expectations.ts) and client UI.
 */

export interface SystemDefault {
  document_type: string;
  document_category: string;
  is_required: boolean;
  applies_to: string[];
  notes?: string;
}

export const ALL_SYSTEM_DEFAULTS: SystemDefault[] = [
  // LLC-family structures (not trusts)
  { document_type: "operating_agreement", document_category: "formation", is_required: true, applies_to: ["llc", "gp"] },
  { document_type: "certificate_of_formation", document_category: "formation", is_required: true, applies_to: ["llc", "corporation", "lp", "gp"] },
  { document_type: "ein_letter", document_category: "tax", is_required: true, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  { document_type: "registered_agent_appointment", document_category: "compliance", is_required: true, applies_to: ["llc", "corporation", "lp", "gp"] },
  { document_type: "certificate_of_good_standing", document_category: "compliance", is_required: false, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  { document_type: "federal_tax_return", document_category: "tax", is_required: false, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  // Trust
  { document_type: "trust_agreement", document_category: "formation", is_required: true, applies_to: ["grantor_trust", "non_grantor_trust"] },
  // Type-specific
  { document_type: "ppm", document_category: "investor", is_required: false, applies_to: ["investment_fund"], notes: "Private Placement Memorandum or offering documents" },
  { document_type: "subscription_agreement", document_category: "investor", is_required: false, applies_to: ["investment_fund"] },
  { document_type: "certificate_of_insurance", document_category: "insurance", is_required: false, applies_to: ["real_estate"], notes: "Property insurance certificate" },
  { document_type: "lease_agreement", document_category: "contracts", is_required: false, applies_to: ["real_estate"], notes: "If rental property" },
  // Structure-specific
  { document_type: "articles_of_incorporation", document_category: "formation", is_required: true, applies_to: ["corporation"] },
  { document_type: "bylaws", document_category: "governance", is_required: true, applies_to: ["corporation"] },
  { document_type: "partnership_agreement", document_category: "formation", is_required: true, applies_to: ["lp"] },
];

/**
 * The four legal-structure buckets surfaced in the document_profiles UI.
 */
export type DocumentScope = "llc" | "corporation" | "lp" | "trust";

export const DOCUMENT_SCOPES: DocumentScope[] = ["llc", "corporation", "lp", "trust"];

/**
 * Map a raw legal_structure value to its document profile scope. Same mapping
 * as migration 049 so engine, seed, and migration agree:
 *   gp → lp, series_llc → llc, grantor_trust|non_grantor_trust → trust.
 */
export function mapToDocumentScope(legalStructure: string | null | undefined): DocumentScope | null {
  switch (legalStructure) {
    case "llc":
    case "series_llc":
      return "llc";
    case "corporation":
      return "corporation";
    case "lp":
    case "gp":
      return "lp";
    case "grantor_trust":
    case "non_grantor_trust":
    case "trust":
      return "trust";
    default:
      return null;
  }
}

/**
 * Return the system defaults that should seed a given scope's profiles.
 */
export function getSystemDefaultsForScope(scope: DocumentScope): SystemDefault[] {
  return ALL_SYSTEM_DEFAULTS.filter((d) =>
    d.applies_to.some((v) => mapToDocumentScope(v) === scope)
  );
}
