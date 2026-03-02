import { DOCUMENT_TYPE_CATEGORIES, DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";

/**
 * PascalCase labels for document types, used in canonical filenames.
 */
export const DOC_TYPE_LABELS: Record<string, string> = {
  operating_agreement: "OperatingAgreement",
  amended_operating_agreement: "AmendedOperatingAgreement",
  certificate_of_formation: "CertOfFormation",
  articles_of_incorporation: "ArticlesOfIncorp",
  articles_of_organization: "ArticlesOfOrg",
  bylaws: "Bylaws",
  partnership_agreement: "PartnershipAgreement",
  trust_agreement: "TrustAgreement",
  trust_amendment: "TrustAmendment",
  ein_letter: "EINLetter",
  tax_return_1065: "TaxReturn1065",
  tax_return_1120s: "TaxReturn1120S",
  tax_return_1041: "TaxReturn1041",
  tax_return_1040: "TaxReturn1040",
  k1: "K1",
  w9: "W9",
  w8ben: "W8BEN",
  ca_form_3522: "CAForm3522",
  ca_form_3536: "CAForm3536",
  ca_form_100es: "CAForm100ES",
  franchise_tax_payment: "StateTaxPayment",
  subscription_agreement: "SubscriptionAgreement",
  capital_call_notice: "CapitalCallNotice",
  distribution_notice: "DistributionNotice",
  investor_questionnaire: "InvestorQuestionnaire",
  side_letter: "SideLetter",
  ppm: "PPM",
  cap_table: "CapTable",
  management_agreement: "ManagementAgreement",
  advisory_agreement: "AdvisoryAgreement",
  consulting_agreement: "ConsultingAgreement",
  service_agreement: "ServiceAgreement",
  license_agreement: "LicenseAgreement",
  lease_agreement: "LeaseAgreement",
  promissory_note: "PromissoryNote",
  loan_agreement: "LoanAgreement",
  guarantee: "Guarantee",
  assignment: "Assignment",
  amendment: "Amendment",
  annual_report: "AnnualReport",
  statement_of_information: "StatementOfInfo",
  certificate_of_good_standing: "CertOfGoodStanding",
  foreign_qualification: "ForeignQualification",
  registered_agent_appointment: "RegisteredAgentAppt",
  certificate_of_insurance: "CertOfInsurance",
  insurance_policy: "InsurancePolicy",
  board_resolution: "BoardResolution",
  consent_of_members: "ConsentOfMembers",
  meeting_minutes: "MeetingMinutes",
  power_of_attorney: "PowerOfAttorney",
  payment_confirmation: "PaymentConfirmation",
  business_license_receipt: "BusinessLicenseReceipt",
  other: "Other",
};

/**
 * PascalCase labels for document categories.
 */
export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  formation: "Formation",
  tax: "Tax",
  investor: "Investor",
  contracts: "Contracts",
  compliance: "Compliance",
  insurance: "Insurance",
  governance: "Governance",
  other: "Other",
};

/**
 * Derive the document category from a document type using DOCUMENT_TYPE_CATEGORIES.
 */
export function getCategoryForDocType(docType: string): DocumentCategory {
  for (const [catKey, cat] of Object.entries(DOCUMENT_TYPE_CATEGORIES)) {
    if (cat.types.includes(docType)) {
      return catKey as DocumentCategory;
    }
  }
  return "other";
}

/**
 * Extract file extension from mime type or original filename.
 */
export function getExtension(mimeType: string | null, originalName: string): string {
  // Try to get from original filename first
  const dotIdx = originalName.lastIndexOf(".");
  if (dotIdx !== -1) {
    return originalName.slice(dotIdx); // includes the dot
  }

  // Fall back to mime type mapping
  const mimeMap: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
  };

  return mimeMap[mimeType || ""] || ".bin";
}

/**
 * Generate a canonical document filename.
 *
 * Format: {ShortName}_{Category}_{DocType}_{FYYear}{collision}.ext
 *
 * @param shortName - Entity short name (or "Unassociated" if none)
 * @param category - Document category
 * @param docType - Document type
 * @param year - Fiscal year (nullable)
 * @param extension - File extension including dot
 * @param collisionCount - Number of existing docs with same params (0 = first)
 */
export function generateDocumentFilename(
  shortName: string | null,
  category: DocumentCategory | null,
  docType: string,
  year: number | null,
  extension: string,
  collisionCount: number
): string {
  const prefix = shortName || "Unassociated";
  const catLabel = category ? CATEGORY_LABELS[category] : CATEGORY_LABELS[getCategoryForDocType(docType)];
  const typeLabel = DOC_TYPE_LABELS[docType] || "Other";
  const yearPart = year ? `FY${year}` : "NoYear";
  const collision = collisionCount > 0 ? `_${collisionCount}` : "";

  return `${prefix}_${catLabel}_${typeLabel}_${yearPart}${collision}${extension}`;
}

/**
 * Validate a short name.
 * Must be 1-30 characters, letters/numbers/hyphens only.
 */
export function validateShortName(value: string): { valid: boolean; error?: string } {
  if (!value || value.length === 0) {
    return { valid: false, error: "Short name is required." };
  }
  if (value.length > 30) {
    return { valid: false, error: "Short name must be 30 characters or fewer." };
  }
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    return { valid: false, error: "Short name can only contain letters, numbers, and hyphens." };
  }
  return { valid: true };
}

/**
 * Generate a human-readable display name from document metadata.
 *
 * Format: "{EntityName} – {Year} {DocTypeLabel}"
 * Falls back gracefully when parts are missing.
 *
 * Returns null if there isn't enough metadata to improve on the original name
 * (i.e. neither entity name nor a non-"other" doc type is available).
 */
export function generateDisplayName(
  entityName: string | null,
  docType: string | null,
  year: number | null,
): string | null {
  const typeLabel = docType && docType !== "other"
    ? DOCUMENT_TYPE_LABELS[docType] || null
    : null;

  // Need at least a type label to generate a meaningful name
  if (!typeLabel) return null;

  const parts: string[] = [];

  if (entityName) parts.push(entityName);

  const detail = year ? `${year} ${typeLabel}` : typeLabel;
  parts.push(detail);

  return parts.join(" – ");
}
