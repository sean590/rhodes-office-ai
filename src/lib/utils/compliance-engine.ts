import { COMPLIANCE_RULES } from "@/lib/data/compliance-rules";
import type { ComplianceRule, DueDateFormula, EntityTypeScope } from "@/lib/data/compliance-rules";
import type { LegalStructure } from "@/lib/types/enums";

/** Safely parse a date string to a Date, handling both "YYYY-MM-DD" and timestamptz formats. */
function parseDate(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00");
}

export interface EntityComplianceInput {
  id: string;
  legal_structure: LegalStructure | null;
  formation_state: string;
  formed_date: string | null;
  registrations: { jurisdiction: string }[];
}

export interface GeneratedObligation {
  rule_id: string;
  jurisdiction: string;
  obligation_type: string;
  name: string;
  description: string;
  frequency: string;
  next_due_date: string | null;
  fee_description: string;
  form_number: string | null;
  portal_url: string | null;
  filed_with: string;
  penalty_description: string | null;
}

/**
 * Map LegalStructure to the EntityTypeScope used in rules.
 * Returns null if no legal structure is set (only "all" scoped rules will match).
 */
function toEntityTypeScope(ls: LegalStructure | null): EntityTypeScope | null {
  if (!ls) return null;
  switch (ls) {
    case "llc":
    case "series_llc":
      return "llc";
    case "corporation":
      return "corporation";
    case "lp":
      return "lp";
    case "trust":
      return "trust";
    case "gp":
    case "sole_prop":
    case "other":
      return null;
  }
}

/**
 * Given an entity and its registrations, returns all compliance
 * obligations the entity must fulfill.
 */
export function generateComplianceObligations(
  entity: EntityComplianceInput
): GeneratedObligation[] {
  const obligations: GeneratedObligation[] = [];
  const entityScope = toEntityTypeScope(entity.legal_structure);

  // Collect all jurisdictions: formation state + foreign registrations
  const allJurisdictions = new Set<string>();
  allJurisdictions.add(entity.formation_state);
  for (const reg of entity.registrations) {
    allJurisdictions.add(reg.jurisdiction);
  }

  for (const jurisdiction of allJurisdictions) {
    const isDomestic = jurisdiction === entity.formation_state;

    // Find matching rules
    const matchingRules = COMPLIANCE_RULES.filter((rule) => {
      if (rule.jurisdiction !== jurisdiction) return false;

      // Check entity type scope
      const matchesType =
        rule.entity_types.includes("all") ||
        (entityScope !== null && rule.entity_types.includes(entityScope));
      if (!matchesType) return false;

      // Check domestic/foreign applicability
      if (isDomestic && rule.applies_to_domestic === false) return false;
      if (!isDomestic && rule.applies_to_foreign === false) return false;

      return true;
    });

    for (const rule of matchingRules) {
      const nextDueDate = calculateNextDueDate(
        rule.due_date,
        entity.formed_date,
        rule.frequency
      );

      obligations.push({
        rule_id: rule.id,
        jurisdiction,
        obligation_type: rule.obligation_type,
        name: rule.name,
        description: rule.description,
        frequency: rule.frequency,
        next_due_date: nextDueDate,
        fee_description: rule.fee.description,
        form_number: rule.form_number || null,
        portal_url: rule.portal_url || null,
        filed_with: rule.filed_with,
        penalty_description: rule.penalty_description || null,
      });
    }
  }

  return obligations;
}

/**
 * Calculate the next due date based on the formula and entity formation date.
 */
export function calculateNextDueDate(
  formula: DueDateFormula,
  formedDate: string | null,
  frequency: string
): string | null {
  const now = new Date();

  switch (formula.type) {
    case "fixed_date": {
      // e.g. May 1 → next May 1
      let year = now.getFullYear();
      const candidate = new Date(year, formula.month - 1, formula.day);
      if (candidate <= now) {
        year++;
      }
      return new Date(year, formula.month - 1, formula.day)
        .toISOString()
        .split("T")[0];
    }

    case "anniversary_month": {
      if (!formedDate) return null;
      const formed = parseDate(formedDate);
      const formedMonth = formed.getMonth(); // 0-indexed
      let year = now.getFullYear();

      const day =
        formula.day === "last"
          ? new Date(year, formedMonth + 1, 0).getDate()
          : formula.day;

      let candidate = new Date(year, formedMonth, day);
      if (candidate <= now) {
        year++;
        const adjustedDay =
          formula.day === "last"
            ? new Date(year, formedMonth + 1, 0).getDate()
            : formula.day;
        candidate = new Date(year, formedMonth, adjustedDay);
      }
      return candidate.toISOString().split("T")[0];
    }

    case "anniversary_month_biennial": {
      if (!formedDate) return null;
      const formed = parseDate(formedDate);
      const formedMonth = formed.getMonth();
      const formedYear = formed.getFullYear();
      let year = now.getFullYear();

      // Find the next biennial year
      const yearsSinceFormed = year - formedYear;
      if (yearsSinceFormed % 2 !== 0) {
        year++;
      }

      const day =
        formula.day === "last"
          ? new Date(year, formedMonth + 1, 0).getDate()
          : formula.day;

      let candidate = new Date(year, formedMonth, day);
      if (candidate <= now) {
        year += 2;
        const adjustedDay =
          formula.day === "last"
            ? new Date(year, formedMonth + 1, 0).getDate()
            : formula.day;
        candidate = new Date(year, formedMonth, adjustedDay);
      }
      return candidate.toISOString().split("T")[0];
    }

    case "relative_to_fiscal_year_end": {
      // Assumes calendar year (Dec 31 FY end) for now
      const fyEndMonth = 11; // December (0-indexed)
      let year = now.getFullYear();
      const dueMonth = fyEndMonth + formula.month_offset;

      let candidate = new Date(year, dueMonth, formula.day);
      if (candidate <= now) {
        candidate = new Date(year + 1, dueMonth, formula.day);
      }
      return candidate.toISOString().split("T")[0];
    }

    case "continuous":
      return null; // No specific due date

    case "formation_relative":
      return null; // One-time, would need to check if already completed

    default:
      return null;
  }
}

/**
 * Calculate the next due date after a completion date (for advancing to next cycle).
 */
export function calculateNextDueDateAfterCompletion(
  rule: ComplianceRule,
  completedDate: string,
  formedDate: string | null
): string | null {
  if (rule.frequency === "one_time" || rule.frequency === "continuous") {
    return null;
  }

  const completed = parseDate(completedDate);
  const formula = rule.due_date;

  switch (formula.type) {
    case "fixed_date": {
      let year = completed.getFullYear();
      const increment = rule.frequency === "biennial" ? 2 : rule.frequency === "decennial" ? 10 : 1;
      const candidate = new Date(year, formula.month - 1, formula.day);
      if (candidate <= completed) {
        year += increment;
      }
      return new Date(year, formula.month - 1, formula.day)
        .toISOString()
        .split("T")[0];
    }

    case "anniversary_month":
    case "anniversary_month_biennial": {
      if (!formedDate) return null;
      const formed = parseDate(formedDate);
      const formedMonth = formed.getMonth();
      let year = completed.getFullYear();
      const increment = formula.type === "anniversary_month_biennial" ? 2 : 1;

      const day =
        formula.day === "last"
          ? new Date(year, formedMonth + 1, 0).getDate()
          : formula.day;

      let candidate = new Date(year, formedMonth, day);
      if (candidate <= completed) {
        year += increment;
        const adjustedDay =
          formula.day === "last"
            ? new Date(year, formedMonth + 1, 0).getDate()
            : formula.day;
        candidate = new Date(year, formedMonth, adjustedDay);
      }
      return candidate.toISOString().split("T")[0];
    }

    case "relative_to_fiscal_year_end": {
      const fyEndMonth = 11;
      let year = completed.getFullYear();
      const dueMonth = fyEndMonth + formula.month_offset;
      let candidate = new Date(year, dueMonth, formula.day);
      if (candidate <= completed) {
        candidate = new Date(year + 1, dueMonth, formula.day);
      }
      return candidate.toISOString().split("T")[0];
    }

    default:
      return null;
  }
}

export type ObligationDisplayStatus =
  | "current"
  | "due_soon"
  | "overdue"
  | "completed"
  | "exempt"
  | "not_applicable";

/**
 * Derives the display status for an obligation.
 * Adds "due_soon" when pending + within 60 days, and "overdue" when pending + past due.
 */
export function getObligationDisplayStatus(
  nextDueDate: string | null,
  status: string
): ObligationDisplayStatus {
  if (status === "completed") return "completed";
  if (status === "exempt") return "exempt";
  if (status === "not_applicable") return "not_applicable";

  if (!nextDueDate) return "current"; // continuous obligations with no due date

  const now = new Date();
  const due = new Date(nextDueDate + "T00:00:00");
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return "overdue";
  if (diffDays <= 60) return "due_soon";
  return "current";
}

/**
 * Get the worst display status across obligations (for card header badge).
 */
export function getWorstObligationStatus(
  statuses: ObligationDisplayStatus[]
): ObligationDisplayStatus {
  if (statuses.includes("overdue")) return "overdue";
  if (statuses.includes("due_soon")) return "due_soon";
  if (statuses.includes("current")) return "current";
  if (statuses.includes("completed")) return "completed";
  if (statuses.includes("exempt")) return "exempt";
  return "not_applicable";
}

/**
 * Look up a compliance rule by its ID.
 */
export function getRuleById(ruleId: string): ComplianceRule | undefined {
  return COMPLIANCE_RULES.find((r) => r.id === ruleId);
}
