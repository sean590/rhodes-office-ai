/**
 * Document type equivalence map.
 *
 * Keys are expectation document_types (what the checklist looks for).
 * Values are arrays of document_types that satisfy that expectation.
 *
 * Intentionally one-directional: "a franchise_tax_payment satisfies an
 * annual_franchise_tax expectation." The reverse isn't necessarily true —
 * an annual_franchise_tax document doesn't satisfy a franchise_tax_payment
 * expectation. Keeps the semantics simple.
 *
 * When adding entries: the KEY is the expectation side (what the checklist
 * or inference engine generates); VALUES are the document side (what the
 * classifier or AI extraction assigns to uploaded files).
 */
export const DOCUMENT_TYPE_ALIASES: Record<string, string[]> = {
  // Franchise tax — inference engine uses state-specific names, classifier
  // uses the generic "franchise_tax_payment".
  annual_franchise_tax: ["franchise_tax_payment", "state_tax_payment"],
  franchise_tax_report: ["franchise_tax_payment", "state_tax_payment"],

  // Federal tax returns — expectations may use the generic "federal_tax_return",
  // but actual docs are classified by form number.
  federal_tax_return: [
    "tax_return_1065",
    "tax_return_1120s",
    "tax_return_1041",
    "tax_return_1040",
  ],

  // EIN letter — "EIN Assignment" is a common name for the IRS EIN
  // confirmation letter, and the classifier may tag it as generic "assignment".
  ein_letter: ["assignment"],

  // Formation documents — articles of organization is the same as
  // certificate of formation in many states. "other" catch-all from
  // misclassified formation docs also accepted.
  certificate_of_formation: ["articles_of_organization"],
  articles_of_organization: ["certificate_of_formation"],
};

/**
 * Check if a document type satisfies an expectation type. Returns true for
 * exact match OR when the document's type appears in the expectation's
 * alias list.
 */
export function documentTypeSatisfies(
  expectationType: string,
  documentType: string,
): boolean {
  if (expectationType === documentType) return true;
  const aliases = DOCUMENT_TYPE_ALIASES[expectationType];
  return aliases ? aliases.includes(documentType) : false;
}
