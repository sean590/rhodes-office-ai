// Compliance Rules — All 50 States + DC + Federal
// Static reference data for generating per-entity compliance obligations.
// Rules change infrequently (legislative sessions). When they do, it's a code update.

import type { TaxClassification } from "@/lib/types/enums";

export type ObligationType =
  | "annual_report"
  | "franchise_tax"
  | "business_license"
  | "information_report"
  | "publication"
  | "registered_agent"
  | "statement_of_info"
  | "estimated_fee"
  | "commerce_tax"
  | "business_entity_tax"
  // Federal + cross-cutting
  | "federal_income_tax"
  | "state_income_tax"
  | "estimated_tax"
  | "ptet"            // Pass-through entity tax election
  | "boi_report"      // FinCEN beneficial ownership information
  | "other";

export type FilingFrequency = "annual" | "biennial" | "one_time" | "continuous" | "decennial" | "quarterly";

// "person" added so personal income tax + estimated-payment rules can target
// individual entities. "all" matches every scope.
export type EntityTypeScope = "llc" | "corporation" | "lp" | "trust" | "person" | "all";

export type DueDateFormula =
  | { type: "fixed_date"; month: number; day: number }
  | { type: "anniversary_month"; day: "last" | number }
  | { type: "anniversary_month_biennial"; day: "last" | number }
  | { type: "relative_to_fiscal_year_end"; month_offset: number; day: number }
  | { type: "formation_relative"; month_offset: number; day: number }
  | { type: "continuous" };

export interface ComplianceRule {
  id: string;
  jurisdiction: string;
  entity_types: EntityTypeScope[];
  // Federal rules also key on the entity's IRS tax election. When present and
  // non-empty, the engine requires the entity's tax_classification to match.
  // State rules omit this field; they match on entity_types alone.
  tax_classifications?: TaxClassification[];
  obligation_type: ObligationType;
  name: string;
  description: string;
  frequency: FilingFrequency;
  due_date: DueDateFormula;
  fee: { amount: number | null; description: string };
  filed_with: string;
  form_number?: string;
  portal_url?: string;
  penalty_description?: string;
  notes?: string;
  first_year_exempt?: boolean;
  revenue_threshold?: { amount: number; description: string };
  applies_to_foreign?: boolean;
  applies_to_domestic?: boolean;
}

export const COMPLIANCE_RULES: ComplianceRule[] = [
  // ═══════════════════════════════════════════════════════════════════
  // ALABAMA (AL)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "AL_ALL_PRIVILEGE_TAX",
    jurisdiction: "AL",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "franchise_tax",
    name: "Business Privilege Tax Return",
    description: "Alabama's business privilege tax applies to all entities organized or doing business in AL. Minimum $100.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 10000, description: "$100 minimum" },
    filed_with: "AL Dept of Revenue",
    form_number: "PPT/CPT",
    penalty_description: "Penalty plus interest on unpaid tax",
    notes: "Separate from income tax. LLCs use Form PPT, corporations use Form CPT.",
  },
  {
    id: "AL_CORP_ANNUAL_REPORT",
    jurisdiction: "AL",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporations only — filed with the privilege tax. No separate fee.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 0, description: "$0 (included with privilege tax)" },
    filed_with: "AL Dept of Revenue",
    notes: "Filed together with the Business Privilege Tax Return.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // ALASKA (AK)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "AK_ALL_BIENNIAL_REPORT",
    jurisdiction: "AK",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "Biennial report due every 2 years by January 2.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 1, day: 2 },
    fee: { amount: 10000, description: "$100 (LLC/Corp), $200 (LP)" },
    filed_with: "AK Division of Corporations",
    notes: "No state income tax.",
  },
  {
    id: "AK_ALL_BUSINESS_LICENSE",
    jurisdiction: "AK",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "business_license",
    name: "Business License Renewal",
    description: "Annual business license required if conducting business in Alaska.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 12, day: 31 },
    fee: { amount: 5000, description: "$50" },
    filed_with: "AK Division of Corporations",
    notes: "Required if conducting business in AK.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // ARIZONA (AZ)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "AZ_LLC_ANNUAL_REPORT",
    jurisdiction: "AZ",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC annual report due at the end of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 0, description: "$0" },
    filed_with: "AZ Corporation Commission",
  },
  {
    id: "AZ_CORP_ANNUAL_REPORT",
    jurisdiction: "AZ",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due at the end of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 4500, description: "$45" },
    filed_with: "AZ Corporation Commission",
  },
  {
    id: "AZ_LLC_PUBLICATION",
    jurisdiction: "AZ",
    entity_types: ["llc"],
    obligation_type: "publication",
    name: "Publication of Formation",
    description: "LLCs must publish a Notice of Formation in a newspaper in the county of the statutory agent within 60 days.",
    frequency: "one_time",
    due_date: { type: "formation_relative", month_offset: 2, day: 0 },
    fee: { amount: null, description: "$200-$500 (varies by county)" },
    filed_with: "Local newspaper",
    applies_to_foreign: false,
    applies_to_domestic: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // ARKANSAS (AR)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "AR_ALL_FRANCHISE_TAX",
    jurisdiction: "AR",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "franchise_tax",
    name: "Annual Franchise Tax Report",
    description: "All entities pay franchise tax. LLCs and LPs pay a flat $150. Corporations pay based on outstanding capital stock ($150 minimum).",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 1 },
    fee: { amount: 15000, description: "$150 (LLC/LP), varies (Corp)" },
    filed_with: "AR Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // CALIFORNIA (CA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "CA_LLC_FRANCHISE_TAX",
    jurisdiction: "CA",
    entity_types: ["llc"],
    obligation_type: "franchise_tax",
    name: "Annual Franchise Tax",
    description: "All LLCs doing business or organized in CA owe an annual $800 minimum tax.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 80000, description: "$800" },
    filed_with: "CA Franchise Tax Board",
    form_number: "FTB 3522",
    portal_url: "https://www.ftb.ca.gov/pay",
    penalty_description: "Penalty + interest on unpaid tax. LLC may be suspended.",
    notes: "Applies even if LLC is inactive.",
  },
  {
    id: "CA_LLC_ESTIMATED_FEE",
    jurisdiction: "CA",
    entity_types: ["llc"],
    obligation_type: "estimated_fee",
    name: "Estimated LLC Fee",
    description: "Revenue-based fee for LLCs with CA gross income over $250K.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 6, day: 15 },
    fee: { amount: null, description: "$900-$11,790 (revenue-based)" },
    filed_with: "CA Franchise Tax Board",
    form_number: "FTB 3536",
    revenue_threshold: { amount: 25000000, description: "Only if CA gross income > $250K" },
    notes: "Fee tiers: $250K-$499K = $900; $500K-$999K = $2,500; $1M-$4.99M = $6,000; $5M+ = $11,790.",
  },
  {
    id: "CA_LLC_SOI",
    jurisdiction: "CA",
    entity_types: ["llc"],
    obligation_type: "statement_of_info",
    name: "Statement of Information",
    description: "Biennial filing with the CA Secretary of State.",
    frequency: "biennial",
    due_date: { type: "anniversary_month_biennial", day: "last" },
    fee: { amount: 2000, description: "$20" },
    filed_with: "CA Secretary of State",
    form_number: "SI-LLC",
  },
  {
    id: "CA_CORP_SOI",
    jurisdiction: "CA",
    entity_types: ["corporation"],
    obligation_type: "statement_of_info",
    name: "Statement of Information",
    description: "Annual filing with the CA Secretary of State.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 2500, description: "$25" },
    filed_with: "CA Secretary of State",
    form_number: "SI-200C",
  },
  {
    id: "CA_CORP_FRANCHISE_TAX",
    jurisdiction: "CA",
    entity_types: ["corporation"],
    obligation_type: "franchise_tax",
    name: "Annual Franchise Tax",
    description: "All corporations doing business or organized in CA owe an annual minimum $800 tax.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 3, day: 15 },
    fee: { amount: 80000, description: "$800 minimum" },
    filed_with: "CA Franchise Tax Board",
    portal_url: "https://www.ftb.ca.gov/pay",
  },
  {
    id: "CA_LP_FRANCHISE_TAX",
    jurisdiction: "CA",
    entity_types: ["lp"],
    obligation_type: "franchise_tax",
    name: "Annual Franchise Tax",
    description: "All LPs doing business or organized in CA owe an annual $800 tax.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 80000, description: "$800" },
    filed_with: "CA Franchise Tax Board",
    form_number: "FTB 3522",
  },

  // ═══════════════════════════════════════════════════════════════════
  // COLORADO (CO)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "CO_ALL_PERIODIC_REPORT",
    jurisdiction: "CO",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Periodic Report",
    description: "Annual periodic report. $10 online. Entities that don't file within 3 months risk dissolution.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 1000, description: "$10" },
    filed_with: "CO Secretary of State",
    portal_url: "https://www.sos.state.co.us/biz",
    penalty_description: "Delinquent after 3 months; entity risks administrative dissolution.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTICUT (CT)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "CT_LLC_ANNUAL_REPORT",
    jurisdiction: "CT",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC annual report due during the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 8000, description: "$80" },
    filed_with: "CT Secretary of State",
  },
  {
    id: "CT_CORP_ANNUAL_REPORT",
    jurisdiction: "CT",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due during the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 15000, description: "$150" },
    filed_with: "CT Secretary of State",
  },
  {
    id: "CT_ALL_BUSINESS_ENTITY_TAX",
    jurisdiction: "CT",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "business_entity_tax",
    name: "Business Entity Tax",
    description: "$250 annual Business Entity Tax (BET) on most business entities, separate from income tax.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 25000, description: "$250" },
    filed_with: "CT Dept of Revenue",
    form_number: "OP-424",
  },

  // ═══════════════════════════════════════════════════════════════════
  // DELAWARE (DE)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "DE_LLC_FRANCHISE_TAX",
    jurisdiction: "DE",
    entity_types: ["llc", "lp"],
    obligation_type: "franchise_tax",
    name: "Annual Franchise Tax",
    description: "Delaware LLCs and LPs pay a flat $300 annual tax. No annual report required.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 6, day: 1 },
    fee: { amount: 30000, description: "$300" },
    filed_with: "DE Division of Corporations",
    portal_url: "https://corp.delaware.gov/alt-entitytaxinstructions/",
    penalty_description: "$200 late fee + 1.5%/month interest.",
  },
  {
    id: "DE_CORP_ANNUAL_REPORT",
    jurisdiction: "DE",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report + Franchise Tax",
    description: "Corporations must file an Annual Report AND pay franchise tax. Min $175-$400 depending on calculation method.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 3, day: 1 },
    fee: { amount: null, description: "$50 report fee + tax (min $175-$400)" },
    filed_with: "DE Division of Corporations",
    portal_url: "https://corp.delaware.gov/paytaxes/",
    penalty_description: "$200 late fee + 1.5%/month interest.",
    notes: "Starting 2025, corporations must include 'Nature of Business' in annual report.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // DISTRICT OF COLUMBIA (DC)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "DC_ALL_BIENNIAL_REPORT",
    jurisdiction: "DC",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "DC requires a biennial report for all business entities.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 30000, description: "$300" },
    filed_with: "DC Dept of Consumer & Regulatory Affairs",
  },

  // ═══════════════════════════════════════════════════════════════════
  // FLORIDA (FL)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "FL_LLC_ANNUAL_REPORT",
    jurisdiction: "FL",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report filed through Sunbiz.org.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 1 },
    fee: { amount: 13875, description: "$138.75" },
    filed_with: "FL Division of Corporations (Sunbiz)",
    portal_url: "https://services.sunbiz.org/Filings/AnnualReport/FilingStart",
    penalty_description: "$400 late fee for reports filed after May 1. Entities not filing by 3rd Friday of September are administratively dissolved.",
  },
  {
    id: "FL_CORP_ANNUAL_REPORT",
    jurisdiction: "FL",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report filed through Sunbiz.org.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 1 },
    fee: { amount: 15000, description: "$150" },
    filed_with: "FL Division of Corporations (Sunbiz)",
    portal_url: "https://services.sunbiz.org/Filings/AnnualReport/FilingStart",
    penalty_description: "$400 late fee for reports filed after May 1.",
  },
  {
    id: "FL_LP_ANNUAL_REPORT",
    jurisdiction: "FL",
    entity_types: ["lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report filed through Sunbiz.org.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 1 },
    fee: { amount: 50000, description: "$500" },
    filed_with: "FL Division of Corporations (Sunbiz)",
    portal_url: "https://services.sunbiz.org/Filings/AnnualReport/FilingStart",
    penalty_description: "$400 late fee for reports filed after May 1.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // GEORGIA (GA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "GA_ALL_ANNUAL_REGISTRATION",
    jurisdiction: "GA",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Registration",
    description: "Georgia requires an annual registration filed by April 1 each year.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 5000, description: "$50" },
    filed_with: "GA Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // HAWAII (HI)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "HI_ALL_ANNUAL_REPORT",
    jurisdiction: "HI",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Due at the end of the anniversary quarter. Filing fee is $15 online.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 1500, description: "$15" },
    filed_with: "HI Department of Commerce",
    notes: "Hawaii uses a quarterly anniversary system — report due at end of the calendar quarter of formation.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // IDAHO (ID)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "ID_ALL_ANNUAL_REPORT",
    jurisdiction: "ID",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Idaho's annual report has no filing fee — one of the few free reports. Due by the end of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 0, description: "$0" },
    filed_with: "ID Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // ILLINOIS (IL)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "IL_LLC_ANNUAL_REPORT",
    jurisdiction: "IL",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC annual report due before the first day of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: 1 },
    fee: { amount: 7500, description: "$75" },
    filed_with: "IL Secretary of State",
    portal_url: "https://www.ilsos.gov/",
  },
  {
    id: "IL_CORP_ANNUAL_REPORT",
    jurisdiction: "IL",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due before the first day of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: 1 },
    fee: { amount: 7500, description: "$75" },
    filed_with: "IL Secretary of State",
    portal_url: "https://www.ilsos.gov/",
  },
  {
    id: "IL_CORP_FRANCHISE_TAX",
    jurisdiction: "IL",
    entity_types: ["corporation"],
    obligation_type: "franchise_tax",
    name: "Franchise Tax",
    description: "Illinois corporate franchise tax based on paid-in capital. Being phased out (fully repealed effective 2028).",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: 1 },
    fee: { amount: null, description: "Based on paid-in capital (being phased out)" },
    filed_with: "IL Secretary of State",
    notes: "Fully repealed effective 2028. LLCs have no franchise tax.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // INDIANA (IN)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "IN_ALL_BIENNIAL_REPORT",
    jurisdiction: "IN",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Business Entity Report",
    description: "Indiana requires a biennial report (every 2 years). Due in the anniversary month.",
    frequency: "biennial",
    due_date: { type: "anniversary_month_biennial", day: "last" },
    fee: { amount: 3200, description: "$32 (online), $50 (paper)" },
    filed_with: "IN Secretary of State",
    portal_url: "https://inbiz.in.gov/",
  },

  // ═══════════════════════════════════════════════════════════════════
  // IOWA (IA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "IA_ALL_BIENNIAL_REPORT",
    jurisdiction: "IA",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "Iowa's biennial report. Domestic entities file in odd-numbered years, foreign in even-numbered years.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 6000, description: "$60" },
    filed_with: "IA Secretary of State",
    notes: "Domestic entities file in odd years, foreign in even years.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // KANSAS (KS)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "KS_LLC_ANNUAL_REPORT",
    jurisdiction: "KS",
    entity_types: ["llc", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report due April 15.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 5500, description: "$55" },
    filed_with: "KS Secretary of State",
  },
  {
    id: "KS_CORP_ANNUAL_REPORT",
    jurisdiction: "KS",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report due April 15.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 4000, description: "$40" },
    filed_with: "KS Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // KENTUCKY (KY)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "KY_ALL_ANNUAL_REPORT",
    jurisdiction: "KY",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Simple $15 annual report due June 30.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 6, day: 30 },
    fee: { amount: 1500, description: "$15" },
    filed_with: "KY Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // LOUISIANA (LA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "LA_LLC_ANNUAL_REPORT",
    jurisdiction: "LA",
    entity_types: ["llc", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC/LP annual report due on the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 3500, description: "$35" },
    filed_with: "LA Secretary of State",
  },
  {
    id: "LA_CORP_ANNUAL_REPORT",
    jurisdiction: "LA",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due on the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 7500, description: "$75" },
    filed_with: "LA Secretary of State",
  },
  {
    id: "LA_CORP_FRANCHISE_TAX",
    jurisdiction: "LA",
    entity_types: ["corporation"],
    obligation_type: "franchise_tax",
    name: "Franchise Tax",
    description: "Corporations pay franchise tax based on capital employed in Louisiana. LLCs do not owe this.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "$1.50 per $1,000 of capital employed (min $10)" },
    filed_with: "LA Dept of Revenue",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MAINE (ME)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "ME_ALL_ANNUAL_REPORT",
    jurisdiction: "ME",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report due June 1 each year. $85 filing fee.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 6, day: 1 },
    fee: { amount: 8500, description: "$85" },
    filed_with: "ME Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MARYLAND (MD)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MD_ALL_ANNUAL_REPORT",
    jurisdiction: "MD",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Maryland combines the annual report and personal property tax return through SDAT.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 30000, description: "$300" },
    filed_with: "MD State Dept of Assessments & Taxation (SDAT)",
    notes: "Entities with personal property in MD must also report it.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MASSACHUSETTS (MA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MA_LLC_ANNUAL_REPORT",
    jurisdiction: "MA",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Massachusetts LLC annual report. $500 fee — one of the highest.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 50000, description: "$500" },
    filed_with: "MA Secretary of the Commonwealth",
  },
  {
    id: "MA_CORP_ANNUAL_REPORT",
    jurisdiction: "MA",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due on the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 12500, description: "$125" },
    filed_with: "MA Secretary of the Commonwealth",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MICHIGAN (MI)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MI_ALL_ANNUAL_REPORT",
    jurisdiction: "MI",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report/Statement",
    description: "All entities file an annual statement by February 15. $25 filing fee.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 2, day: 15 },
    fee: { amount: 2500, description: "$25" },
    filed_with: "MI Dept of Licensing & Regulatory Affairs (LARA)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MINNESOTA (MN)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MN_ALL_ANNUAL_RENEWAL",
    jurisdiction: "MN",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Renewal",
    description: "Minnesota's annual renewal is free and due by December 31 each year.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 12, day: 31 },
    fee: { amount: 0, description: "$0" },
    filed_with: "MN Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MISSISSIPPI (MS)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MS_CORP_ANNUAL_REPORT",
    jurisdiction: "MS",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Only corporations have an annual report requirement. LLCs do NOT file.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 2500, description: "$25" },
    filed_with: "MS Secretary of State",
    notes: "Mississippi LLCs do NOT file annual reports with the SOS.",
  },
  {
    id: "MS_CORP_FRANCHISE_TAX",
    jurisdiction: "MS",
    entity_types: ["corporation"],
    obligation_type: "franchise_tax",
    name: "Franchise Tax",
    description: "Corporations pay franchise tax based on capital.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 3, day: 15 },
    fee: { amount: null, description: "$2.50 per $1,000 of capital (min $25)" },
    filed_with: "MS Dept of Revenue",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MISSOURI (MO)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MO_LLC_ANNUAL_REGISTRATION",
    jurisdiction: "MO",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Registration",
    description: "Missouri LLCs file a free annual registration online.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 0, description: "$0 (online)" },
    filed_with: "MO Secretary of State",
  },
  {
    id: "MO_CORP_ANNUAL_REPORT",
    jurisdiction: "MO",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporations file an annual report for $20.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 2000, description: "$20" },
    filed_with: "MO Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MONTANA (MT)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "MT_ALL_ANNUAL_REPORT",
    jurisdiction: "MT",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$20 annual report due April 15.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 2000, description: "$20" },
    filed_with: "MT Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEBRASKA (NE)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NE_LLC_BIENNIAL_REPORT",
    jurisdiction: "NE",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "Biennial reports follow a domestic/foreign schedule similar to Iowa.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 1000, description: "$10" },
    filed_with: "NE Secretary of State",
    notes: "Domestic entities file in odd years, foreign in even years.",
  },
  {
    id: "NE_CORP_BIENNIAL_REPORT",
    jurisdiction: "NE",
    entity_types: ["corporation", "lp"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "Biennial reports follow a domestic/foreign schedule.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 2600, description: "$26" },
    filed_with: "NE Secretary of State",
  },
  {
    id: "NE_LLC_PUBLICATION",
    jurisdiction: "NE",
    entity_types: ["llc"],
    obligation_type: "publication",
    name: "Publication of Organization",
    description: "Nebraska requires newspaper publication for LLCs at formation — 3 consecutive weeks.",
    frequency: "one_time",
    due_date: { type: "formation_relative", month_offset: 1, day: 0 },
    fee: { amount: null, description: "$50-$150 (varies)" },
    filed_with: "Local newspaper",
    applies_to_foreign: false,
    applies_to_domestic: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEVADA (NV)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NV_LLC_ANNUAL_LIST",
    jurisdiction: "NV",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual List of Managers/Members",
    description: "Annual list of managers/members due by the last day of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 15000, description: "$150" },
    filed_with: "NV Secretary of State",
    portal_url: "https://www.nvsilverflume.gov",
  },
  {
    id: "NV_LLC_BUSINESS_LICENSE",
    jurisdiction: "NV",
    entity_types: ["llc", "lp"],
    obligation_type: "business_license",
    name: "State Business License",
    description: "Annual business license renewal — $200 for LLCs/LPs.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 20000, description: "$200" },
    filed_with: "NV Secretary of State",
    portal_url: "https://www.nvsilverflume.gov",
    notes: "Filed together with the Annual List.",
  },
  {
    id: "NV_CORP_ANNUAL_LIST",
    jurisdiction: "NV",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual List of Officers/Directors",
    description: "Annual list due by the last day of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 15000, description: "$150" },
    filed_with: "NV Secretary of State",
    portal_url: "https://www.nvsilverflume.gov",
  },
  {
    id: "NV_CORP_BUSINESS_LICENSE",
    jurisdiction: "NV",
    entity_types: ["corporation"],
    obligation_type: "business_license",
    name: "State Business License",
    description: "Annual business license renewal — $500 for corporations.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 50000, description: "$500" },
    filed_with: "NV Secretary of State",
    portal_url: "https://www.nvsilverflume.gov",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEW HAMPSHIRE (NH)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NH_ALL_ANNUAL_REPORT",
    jurisdiction: "NH",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$100 annual report due April 1.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 10000, description: "$100" },
    filed_with: "NH Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEW JERSEY (NJ)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NJ_ALL_ANNUAL_REPORT",
    jurisdiction: "NJ",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "NJ annual report due during the anniversary month for a $75 fee.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 7500, description: "$75" },
    filed_with: "NJ Division of Revenue",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEW MEXICO (NM)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NM_CORP_BIENNIAL_REPORT",
    jurisdiction: "NM",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Biennial Report",
    description: "Only corporations file a biennial report. LLCs have NO annual report requirement.",
    frequency: "biennial",
    due_date: { type: "fixed_date", month: 11, day: 15 },
    fee: { amount: 2500, description: "$25" },
    filed_with: "NM Secretary of State",
    notes: "NM LLCs have NO annual report — one of very few states.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEW YORK (NY)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NY_ALL_BIENNIAL_STATEMENT",
    jurisdiction: "NY",
    entity_types: ["llc", "corporation"],
    obligation_type: "annual_report",
    name: "Biennial Statement",
    description: "Biennial statement due every 2 years in the anniversary month.",
    frequency: "biennial",
    due_date: { type: "anniversary_month_biennial", day: "last" },
    fee: { amount: 900, description: "$9" },
    filed_with: "NY Department of State",
    portal_url: "https://filing.dos.ny.gov/eBiennialWeb/",
    notes: "NY does NOT charge a late fee for biennial statements.",
  },
  {
    id: "NY_LLC_PUBLICATION",
    jurisdiction: "NY",
    entity_types: ["llc"],
    obligation_type: "publication",
    name: "Publication Requirement",
    description: "Newly formed LLCs must publish notice in two newspapers for 6 consecutive weeks within 120 days of formation.",
    frequency: "one_time",
    due_date: { type: "formation_relative", month_offset: 4, day: 0 },
    fee: { amount: null, description: "$50 filing fee + newspaper costs ($200-$2,000+)" },
    filed_with: "NY Department of State",
    form_number: "Form 1708",
    penalty_description: "Failure to publish within 120 days suspends the LLC's authority to do business.",
    notes: "NYC publications can cost $1,000-$2,000+. Most expensive publication requirement in the country.",
    applies_to_foreign: false,
    applies_to_domestic: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // NORTH CAROLINA (NC)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "NC_ALL_ANNUAL_REPORT",
    jurisdiction: "NC",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$200 annual report due April 15.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: 20000, description: "$200" },
    filed_with: "NC Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NORTH DAKOTA (ND)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "ND_ALL_ANNUAL_REPORT",
    jurisdiction: "ND",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report due November 15 each year. $50 filing fee.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 11, day: 15 },
    fee: { amount: 5000, description: "$50" },
    filed_with: "ND Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // OHIO (OH)
  // ═══════════════════════════════════════════════════════════════════
  // Ohio LLCs and Corps have NO annual report requirement.
  // The Commercial Activity Tax (CAT) is a revenue threshold tax, not an SOS filing.

  // ═══════════════════════════════════════════════════════════════════
  // OKLAHOMA (OK)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "OK_ALL_ANNUAL_CERTIFICATE",
    jurisdiction: "OK",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Certificate",
    description: "$25 annual certificate due on the anniversary of formation.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 2500, description: "$25" },
    filed_with: "OK Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // OREGON (OR)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "OR_ALL_ANNUAL_REPORT",
    jurisdiction: "OR",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$100 annual report due on the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 10000, description: "$100" },
    filed_with: "OR Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // PENNSYLVANIA (PA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "PA_ALL_DECENNIAL_REPORT",
    jurisdiction: "PA",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Decennial Report",
    description: "Pennsylvania only requires a report every 10 years. No annual report. No franchise tax for LLCs.",
    frequency: "decennial",
    due_date: { type: "fixed_date", month: 12, day: 31 },
    fee: { amount: 7000, description: "$70" },
    filed_with: "PA Department of State",
    notes: "Due by Dec 31 of the year ending in '1' (2021, 2031, etc.).",
  },

  // ═══════════════════════════════════════════════════════════════════
  // RHODE ISLAND (RI)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "RI_LLC_ANNUAL_REPORT",
    jurisdiction: "RI",
    entity_types: ["llc", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC/LP annual report due November 1.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 11, day: 1 },
    fee: { amount: 5000, description: "$50" },
    filed_with: "RI Secretary of State",
  },
  {
    id: "RI_CORP_ANNUAL_REPORT",
    jurisdiction: "RI",
    entity_types: ["corporation"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation annual report due on the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 5000, description: "$50" },
    filed_with: "RI Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SOUTH CAROLINA (SC)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "SC_ALL_ANNUAL_REPORT",
    jurisdiction: "SC",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "South Carolina's annual report is free for all entities.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 0, description: "$0 (online)" },
    filed_with: "SC Secretary of State",
  },
  {
    id: "SC_CORP_LICENSE_FEE",
    jurisdiction: "SC",
    entity_types: ["corporation"],
    obligation_type: "franchise_tax",
    name: "License Fee",
    description: "Corporations pay a license fee based on capital stock and paid-in surplus.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "$25 minimum (based on capital/surplus)" },
    filed_with: "SC Dept of Revenue",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SOUTH DAKOTA (SD)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "SD_ALL_ANNUAL_REPORT",
    jurisdiction: "SD",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$50 annual report due on the first day of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: 1 },
    fee: { amount: 5000, description: "$50" },
    filed_with: "SD Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // TENNESSEE (TN)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "TN_LLC_ANNUAL_REPORT",
    jurisdiction: "TN",
    entity_types: ["llc"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "LLC annual report. $300 fee — one of the highest SOS report fees.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 30000, description: "$300" },
    filed_with: "TN Secretary of State",
  },
  {
    id: "TN_CORP_ANNUAL_REPORT",
    jurisdiction: "TN",
    entity_types: ["corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Corporation/LP annual report.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 1 },
    fee: { amount: 2000, description: "$20 minimum" },
    filed_with: "TN Secretary of State",
  },
  {
    id: "TN_ALL_FRANCHISE_TAX",
    jurisdiction: "TN",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "franchise_tax",
    name: "Franchise Tax",
    description: "Based on net worth or book value of property in TN. Rate: $0.25 per $100. Minimum $100. Being phased out.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 4, day: 15 },
    fee: { amount: null, description: "Based on net worth (min $100)" },
    filed_with: "TN Dept of Revenue",
    notes: "Being phased out — reduced 50% starting 2024.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // TEXAS (TX)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "TX_ALL_FRANCHISE_TAX",
    jurisdiction: "TX",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "franchise_tax",
    name: "Franchise Tax Report",
    description: "Texas franchise (margin) tax. No-tax-due threshold is $2.47M. Must still file even if under threshold.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 15 },
    fee: { amount: 0, description: "$0 (no filing fee)" },
    filed_with: "TX Comptroller",
    portal_url: "https://comptroller.texas.gov/taxes/franchise/",
    notes: "No-tax-due threshold: $2.47M (2024-2025), $2.65M (2026-2027). Above: 0.75% rate (0.375% retail/wholesale).",
  },
  {
    id: "TX_ALL_PIR",
    jurisdiction: "TX",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "information_report",
    name: "Public Information Report (PIR)",
    description: "Annual Public Information Report filed with the franchise tax return. Required even if no tax is due.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 5, day: 15 },
    fee: { amount: 0, description: "$0" },
    filed_with: "TX Comptroller",
    form_number: "Form 05-102",
    penalty_description: "Failure to file results in forfeiture of the right to do business.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // UTAH (UT)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "UT_ALL_ANNUAL_RENEWAL",
    jurisdiction: "UT",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Renewal",
    description: "$20 annual renewal due in the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 2000, description: "$20" },
    filed_with: "UT Division of Corporations",
  },

  // ═══════════════════════════════════════════════════════════════════
  // VERMONT (VT)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "VT_ALL_ANNUAL_REPORT",
    jurisdiction: "VT",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$35 annual report due in the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 3500, description: "$35" },
    filed_with: "VT Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // VIRGINIA (VA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "VA_ALL_ANNUAL_FEE",
    jurisdiction: "VA",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Registration Fee",
    description: "$50 annual registration fee due by the end of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 5000, description: "$50" },
    filed_with: "VA State Corporation Commission",
  },

  // ═══════════════════════════════════════════════════════════════════
  // WASHINGTON (WA)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "WA_ALL_ANNUAL_REPORT",
    jurisdiction: "WA",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$60 annual report due at the end of the anniversary month.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 6000, description: "$60" },
    filed_with: "WA Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // WEST VIRGINIA (WV)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "WV_ALL_ANNUAL_REPORT",
    jurisdiction: "WV",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$25 annual report due July 1 each year.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 7, day: 1 },
    fee: { amount: 2500, description: "$25" },
    filed_with: "WV Secretary of State",
  },

  // ═══════════════════════════════════════════════════════════════════
  // WISCONSIN (WI)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "WI_ALL_ANNUAL_REPORT",
    jurisdiction: "WI",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "$25 annual report due at the end of the calendar quarter containing the anniversary date.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: "last" },
    fee: { amount: 2500, description: "$25" },
    filed_with: "WI Department of Financial Institutions",
    notes: "Due at end of the calendar quarter containing the anniversary date.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // WYOMING (WY)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "WY_ALL_ANNUAL_REPORT",
    jurisdiction: "WY",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "annual_report",
    name: "Annual Report",
    description: "Annual report with minimum $60 fee. Fee scales with total assets in Wyoming.",
    frequency: "annual",
    due_date: { type: "anniversary_month", day: 1 },
    fee: { amount: 6000, description: "$60 minimum (based on WY assets)" },
    filed_with: "WY Secretary of State",
    notes: "$60 for assets up to $250K, then $0.0002 per dollar of assets. No state income tax.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // FEDERAL — IRS / FinCEN
  // Match on jurisdiction "federal" + tax_classifications. The engine adds
  // "federal" to every entity's jurisdiction list, so federal rules are
  // checked for every entity regardless of formation_state.
  // ═══════════════════════════════════════════════════════════════════

  // --- C Corporation ---
  {
    id: "FED_CCORP_1120",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["c_corp"],
    obligation_type: "federal_income_tax",
    name: "Form 1120 — U.S. Corporate Income Tax Return",
    description: "Annual income tax return for C corporations. Due 4th month after fiscal year end (April 15 for calendar year).",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 4, day: 15 },
    fee: { amount: null, description: "Tax liability varies" },
    filed_with: "IRS",
    form_number: "1120",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1120",
    penalty_description: "5% of unpaid tax per month, up to 25%. Plus interest.",
  },
  {
    id: "FED_CCORP_EST_TAX",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["c_corp"],
    obligation_type: "estimated_tax",
    name: "Estimated Tax Payments (Form 1120-W)",
    description: "Quarterly estimated tax payments for C corps expecting $500+ in tax liability.",
    frequency: "quarterly",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "25% of estimated annual tax per quarter" },
    filed_with: "IRS",
    form_number: "1120-W",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1120-w",
    penalty_description: "Underpayment penalty if payments fall short",
    notes: "Due dates: April 15, June 15, September 15, December 15. Engine generates the April 15 deadline; quarterly recurrence advances the rest as each is completed.",
  },

  // --- S Corporation ---
  {
    id: "FED_SCORP_1120S",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["s_corp"],
    obligation_type: "federal_income_tax",
    name: "Form 1120-S — U.S. Income Tax Return for S Corporation",
    description: "Annual information return for S corporations. Due 3rd month after fiscal year end (March 15 for calendar year). K-1s due to shareholders by same date.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 3, day: 15 },
    fee: { amount: null, description: "Pass-through — no entity-level tax (generally)" },
    filed_with: "IRS",
    form_number: "1120-S",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1120-s",
    penalty_description: "$220/month per shareholder (2024 rate), up to 12 months. Late K-1 penalties apply.",
  },

  // --- Partnership (LLCs taxed as partnership, LPs, GPs) ---
  {
    id: "FED_PARTNERSHIP_1065",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["partnership"],
    obligation_type: "federal_income_tax",
    name: "Form 1065 — U.S. Return of Partnership Income",
    description: "Annual information return for partnerships. Due 3rd month after fiscal year end (March 15 for calendar year). Schedule K-1s due to partners by same date.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 3, day: 15 },
    fee: { amount: null, description: "Pass-through — no entity-level tax" },
    filed_with: "IRS",
    form_number: "1065",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1065",
    penalty_description: "$220/month per partner (2024 rate), up to 12 months.",
  },

  // --- Trust (non-grantor) ---
  {
    id: "FED_TRUST_1041",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["trust_non_grantor"],
    obligation_type: "federal_income_tax",
    name: "Form 1041 — U.S. Income Tax Return for Estates and Trusts",
    description: "Annual fiduciary income tax return. Due April 15 for calendar-year trusts. K-1s due to beneficiaries by same date.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 4, day: 15 },
    fee: { amount: null, description: "Tax on undistributed income" },
    filed_with: "IRS",
    form_number: "1041",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1041",
    penalty_description: "5% of unpaid tax per month, up to 25%.",
  },

  // --- Trust (grantor — optional 1041 if the trust has its own EIN) ---
  {
    id: "FED_GRANTOR_TRUST_1041",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["trust_grantor"],
    obligation_type: "federal_income_tax",
    name: "Form 1041 — Grantor Trust Information Return (optional)",
    description: "Optional information return for grantor trusts. Many grantor trusts skip this and report directly on the grantor's 1040. File if the trust has its own EIN and receives income statements.",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 4, day: 15 },
    fee: { amount: null, description: "No separate tax — income reported on grantor's return" },
    filed_with: "IRS",
    form_number: "1041",
    notes: "Optional for grantor trusts. Required if trust has its own EIN and receives 1099s.",
  },

  // --- Tax-Exempt Organizations ---
  {
    id: "FED_EXEMPT_990",
    jurisdiction: "federal",
    entity_types: ["all"],
    tax_classifications: ["tax_exempt"],
    obligation_type: "federal_income_tax",
    name: "Form 990 — Return of Organization Exempt from Income Tax",
    description: "Annual information return for tax-exempt organizations. Due 5th month after fiscal year end (May 15 for calendar year).",
    frequency: "annual",
    due_date: { type: "relative_to_fiscal_year_end", month_offset: 5, day: 15 },
    fee: { amount: null, description: "No tax — information return" },
    filed_with: "IRS",
    form_number: "990",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-990",
    penalty_description: "$20/day (small orgs) or $100/day (large orgs), up to the lesser of $10,000 or 5% of gross receipts. Auto-revocation after 3 consecutive years of non-filing.",
  },

  // --- Person (individual) ---
  // Person entities default to sole_prop in the engine when tax_classification
  // is null, so they pick these rules up automatically.
  {
    id: "FED_PERSON_1040",
    jurisdiction: "federal",
    entity_types: ["person"],
    tax_classifications: ["sole_prop"],
    obligation_type: "federal_income_tax",
    name: "Form 1040 — U.S. Individual Income Tax Return",
    description: "Annual personal income tax return. Includes Schedule C (sole prop), Schedule E (rental/partnership/S corp income), Schedule D (capital gains). Due April 15.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "Tax liability varies" },
    filed_with: "IRS",
    form_number: "1040",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1040",
    penalty_description: "5% of unpaid tax per month, up to 25%. Plus 0.5%/month for late payment.",
  },
  {
    id: "FED_PERSON_EST_TAX",
    jurisdiction: "federal",
    entity_types: ["person"],
    tax_classifications: ["sole_prop"],
    obligation_type: "estimated_tax",
    name: "Estimated Tax Payments (Form 1040-ES)",
    description: "Quarterly estimated tax payments for individuals with significant non-wage income (partnership distributions, rental income, capital gains). Due April 15, June 15, September 15, January 15.",
    frequency: "quarterly",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "25% of estimated annual tax per quarter" },
    filed_with: "IRS",
    form_number: "1040-ES",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-1040-es",
    penalty_description: "Underpayment penalty if payments fall short of safe harbor (110% of prior year tax or 90% of current year tax).",
    notes: "Due dates: April 15, June 15, September 15, January 15 (of following year). Critical for family office principals receiving K-1 income from multiple pass-through entities.",
  },

  // --- All entities (cross-classification) ---
  {
    id: "FED_ALL_BOI",
    jurisdiction: "federal",
    entity_types: ["llc", "corporation", "lp"],
    obligation_type: "boi_report",
    name: "Beneficial Ownership Information (BOI) Report",
    description: "FinCEN BOI report required for most entities. Entities formed before 2024 had until Jan 1, 2025 (currently under litigation — check current status). New entities must file within 90 days of formation.",
    frequency: "one_time",
    due_date: { type: "formation_relative", month_offset: 3, day: 0 },
    fee: { amount: 0, description: "No filing fee" },
    filed_with: "FinCEN",
    form_number: "BOIR",
    portal_url: "https://boiefiling.fincen.gov",
    penalty_description: "$500/day civil penalty, criminal penalties up to $10,000 and/or 2 years imprisonment.",
    notes: "Subject to ongoing litigation. CTA enforcement has been paused and resumed multiple times. Check current status.",
  },

  {
    id: "FED_ALL_EIN_CHANGE",
    jurisdiction: "federal",
    entity_types: ["all"],
    obligation_type: "other",
    name: "Responsible Party Change Notification (Form 8822-B)",
    description: "Must notify IRS within 60 days if the entity's responsible party (the person who controls/manages/directs the entity) changes.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No filing fee" },
    filed_with: "IRS",
    form_number: "8822-B",
    portal_url: "https://www.irs.gov/forms-pubs/about-form-8822-b",
    notes: "Triggered by management changes, not calendar-based. Engine generates as a continuous obligation — no specific due date.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // STATE PERSONAL INCOME TAX
  // Keyed on entity_types: ["person"] — these match individuals filing
  // resident income tax returns in their state of residence (stored as
  // formation_state on the person entity).
  //
  // Informational no-income-tax states are included so the dashboard can
  // show an explicit "no state income tax" entry rather than leaving a blank
  // column. They use type: "continuous" + fee.amount: 0 so they generate an
  // obligation with no due date that completion tracking leaves in place.
  // ═══════════════════════════════════════════════════════════════════

  // --- No-income-tax states (informational) ---
  {
    id: "FL_PERSON_NO_INCOME_TAX",
    jurisdiction: "FL",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Florida Personal Income Tax — None",
    description: "Florida does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "TX_PERSON_NO_INCOME_TAX",
    jurisdiction: "TX",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Texas Personal Income Tax — None",
    description: "Texas does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "NV_PERSON_NO_INCOME_TAX",
    jurisdiction: "NV",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Nevada Personal Income Tax — None",
    description: "Nevada does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "WY_PERSON_NO_INCOME_TAX",
    jurisdiction: "WY",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Wyoming Personal Income Tax — None",
    description: "Wyoming does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "WA_PERSON_NO_INCOME_TAX",
    jurisdiction: "WA",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Washington Personal Income Tax — None",
    description: "Washington does not impose a state personal income tax on wages. (A separate 7% capital gains tax applies to gains above $250K — not tracked here.) Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax on wages" },
    filed_with: "N/A",
    notes: "Informational — WA capital gains tax not tracked by this rule.",
  },
  {
    id: "SD_PERSON_NO_INCOME_TAX",
    jurisdiction: "SD",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "South Dakota Personal Income Tax — None",
    description: "South Dakota does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "AK_PERSON_NO_INCOME_TAX",
    jurisdiction: "AK",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Alaska Personal Income Tax — None",
    description: "Alaska does not impose a state personal income tax. Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — no filing required.",
  },
  {
    id: "NH_PERSON_NO_INCOME_TAX",
    jurisdiction: "NH",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "New Hampshire Personal Income Tax — None",
    description: "New Hampshire does not impose a broad-based state personal income tax. (A 5% interest-and-dividends tax was phased out after tax year 2024.) Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — the former I&D tax is no longer in effect.",
  },
  {
    id: "TN_PERSON_NO_INCOME_TAX",
    jurisdiction: "TN",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Tennessee Personal Income Tax — None",
    description: "Tennessee does not impose a state personal income tax. (The Hall income tax on investment income was repealed effective 2021.) Informational entry only.",
    frequency: "continuous",
    due_date: { type: "continuous" },
    fee: { amount: 0, description: "No state income tax" },
    filed_with: "N/A",
    notes: "Informational — the former Hall tax is no longer in effect.",
  },

  // --- CA personal income tax ---
  {
    id: "CA_PERSON_540",
    jurisdiction: "CA",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Form 540 — California Resident Income Tax Return",
    description: "Annual California personal income tax return. Due April 15 (aligned with federal).",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "Tax rates 1%–13.3% (progressive)" },
    filed_with: "CA Franchise Tax Board",
    form_number: "540",
    portal_url: "https://www.ftb.ca.gov",
    penalty_description: "5% of unpaid tax per month (failure to file) plus 0.5%/month (failure to pay). Plus interest.",
  },

  // --- NY personal income tax ---
  {
    id: "NY_PERSON_IT201",
    jurisdiction: "NY",
    entity_types: ["person"],
    obligation_type: "state_income_tax",
    name: "Form IT-201 — New York Resident Income Tax Return",
    description: "Annual New York personal income tax return. Due April 15 (aligned with federal).",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 4, day: 15 },
    fee: { amount: null, description: "Tax rates 4%–10.9% (progressive)" },
    filed_with: "NY Department of Taxation and Finance",
    form_number: "IT-201",
    portal_url: "https://www.tax.ny.gov",
    penalty_description: "5% of unpaid tax per month (failure to file) plus 0.5%/month (failure to pay). Plus interest.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // STATE PASS-THROUGH ENTITY TAX (PTET)
  // Optional elections where a pass-through entity pays state tax on
  // behalf of its owners — a SALT-cap workaround. These generate as
  // pending obligations; users disable them via the three-tier overrides
  // on entities that don't elect in.
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "CA_PTET",
    jurisdiction: "CA",
    entity_types: ["llc", "lp", "corporation"],
    tax_classifications: ["partnership", "s_corp"],
    obligation_type: "ptet",
    name: "California Pass-Through Entity Tax (PTET) Election",
    description: "Optional annual election for pass-through entities to pay 9.3% CA tax at the entity level. Election is made on the original return. Lets owners deduct state taxes beyond the $10K SALT cap.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 3, day: 15 },
    fee: { amount: null, description: "9.3% of qualified net income" },
    filed_with: "CA Franchise Tax Board",
    notes: "Optional — disable on the entity or org-wide if this election is not being made.",
  },
  {
    id: "NY_PTET",
    jurisdiction: "NY",
    entity_types: ["llc", "lp", "corporation"],
    tax_classifications: ["partnership", "s_corp"],
    obligation_type: "ptet",
    name: "New York Pass-Through Entity Tax (PTET) Election",
    description: "Optional annual election for partnerships and S corps to pay NY tax at the entity level. Must elect by March 15 of the tax year.",
    frequency: "annual",
    due_date: { type: "fixed_date", month: 3, day: 15 },
    fee: { amount: null, description: "Tax rates 6.85%–10.9% on NY-source income" },
    filed_with: "NY Department of Taxation and Finance",
    notes: "Optional — must opt in annually. Disable on the entity or org-wide if not electing.",
  },
];
