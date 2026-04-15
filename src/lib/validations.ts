import { z } from "zod";

// Helper: optional string that accepts undefined, null, or "" — all of which
// the wizard / API may send for unfilled fields.
const optionalString = (max?: number) => {
  let s = z.string();
  if (max != null) s = s.max(max);
  return s.optional().nullable().or(z.literal(""));
};

export const createEntitySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.string().min(1, "Type is required"),
  // Required for business entities (LLCs, trusts, etc.). Optional for persons
  // (used as residence_state) and joint_title entities (has no formation state).
  formation_state: optionalString(),
  short_name: z.string().min(1, "Short name is required").max(50),
  ein: z.string().regex(/^\d{2}-?\d{7}$/, "Invalid EIN format").optional().nullable().or(z.literal("")),
  formed_date: optionalString(),
  registered_agent: optionalString(255),
  address: optionalString(500),
  parent_entity_id: z.string().uuid().optional().nullable().or(z.literal("")),
  notes: optionalString(5000),
  legal_structure: optionalString(),
  ssn_last_4: z.string().regex(/^\d{4}$/, "SSN Last 4 must be 4 digits").optional().nullable().or(z.literal("")),
  aliases: z.array(z.string().max(255)).max(20).optional(),
}).superRefine((data, ctx) => {
  // Business entities must carry a formation_state; persons/joint_title don't.
  const businessTypes = new Set(["holding_company", "investment_fund", "operating_company", "real_estate", "special_purpose", "management_company", "trust", "other"]);
  if (businessTypes.has(data.type) && !data.formation_state) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Formation state is required", path: ["formation_state"] });
  }
});

export const updateEntitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.string().optional(),
  formation_state: z.string().optional(),
  short_name: z.string().min(1).max(50).optional(),
  ein: z.string().regex(/^\d{2}-?\d{7}$/).optional().nullable(),
  formed_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  registered_agent: z.string().max(255).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  parent_entity_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.enum(["active", "inactive", "dissolved"]).optional(),
  legal_structure: z.string().optional().nullable(),
  business_purpose: z.string().max(1000).optional().nullable(),
  aliases: z.array(z.string().max(255)).max(20).optional().nullable(),
  ssn_last_4: z.string().regex(/^\d{4}$/, "SSN Last 4 must be 4 digits").optional().nullable().or(z.literal("")),
});

export const userRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

export const inviteUserSchema = z.object({
  email: z.email("Invalid email address"),
  role: z.enum(["admin", "member", "viewer"]).default("viewer"),
});

export const chatMessageSchema = z.object({
  session_id: z.string().uuid("Invalid session ID"),
  message: z.string().min(1, "Message is required").max(10000),
  page_context: z.object({
    page: z.string(),
    entityId: z.string().optional(),
    entityName: z.string().optional(),
    investmentId: z.string().optional(),
    investmentName: z.string().optional(),
    documentId: z.string().optional(),
    filters: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

export const createBatchSchema = z.object({
  name: z.string().max(255).optional(),
  context: z.enum(["global", "entity", "onboarding", "chat"]).default("global"),
  entity_id: z.string().uuid().optional().nullable(),
  entity_discovery: z.boolean().default(false),
});

// --- Additional mutation schemas ---

export const createRelationshipSchema = z.object({
  type: z.string().min(1, "Type is required").max(100),
  description: z.string().max(1000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  from_entity_id: z.string().uuid().optional().nullable(),
  from_directory_id: z.string().uuid().optional().nullable(),
  to_entity_id: z.string().uuid().optional().nullable(),
  to_directory_id: z.string().uuid().optional().nullable(),
  frequency: z.string().max(50).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  effective_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  annual_estimate: z.number().int().optional().nullable(),
  document_ref: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateRelationshipSchema = createRelationshipSchema.partial();

export const createDirectoryEntrySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.string().min(1, "Type is required").max(100),
  email: z.string().email().optional().nullable().or(z.literal("")),
  aliases: z.array(z.string().max(255)).max(20).optional(),
});

export const updateDirectoryEntrySchema = createDirectoryEntrySchema.partial();

export const createRegistrationSchema = z.object({
  jurisdiction: z.string().min(1, "Jurisdiction is required").max(100),
});

export const updateRegistrationSchema = z.object({
  registration_id: z.string().uuid(),
  last_filing_date: z.string().optional().nullable(),
  qualification_date: z.string().optional().nullable(),
  state_id: z.string().max(100).optional().nullable(),
  filing_exempt: z.boolean().optional(),
});

export const createCapTableEntrySchema = z.object({
  investor_name: z.string().max(255).optional().nullable(),
  investor_type: z.string().max(50).optional().nullable(),
  units: z.number().optional().nullable(),
  ownership_pct: z.number().min(0).max(100).optional().nullable(),
  capital_contributed: z.number().int().optional().nullable(),
  investment_date: z.string().optional().nullable(),
  investor_entity_id: z.string().uuid().optional().nullable(),
  investor_directory_id: z.string().uuid().optional().nullable(),
});

export const entityPersonRefSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const deleteByIdSchema = z.object({
  member_id: z.string().uuid().optional(),
  manager_id: z.string().uuid().optional(),
  role_id: z.string().uuid().optional(),
  partnership_rep_id: z.string().uuid().optional(),
  entry_id: z.string().uuid().optional(),
  registration_id: z.string().uuid().optional(),
  field_def_id: z.string().uuid().optional(),
});

export const updateComplianceSchema = z.object({
  status: z.enum(["pending", "completed", "overdue", "not_applicable"]).optional(),
  completed_at: z.string().optional().nullable(),
  completed_by: z.string().max(255).optional().nullable(),
  payment_amount: z.number().int().optional().nullable(),
  confirmation: z.string().max(500).optional().nullable(),
  document_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateTrustDetailsSchema = z.object({
  trust_type: z.string().max(100).optional(),
  trust_date: z.string().optional().nullable(),
  grantor_name: z.string().max(255).optional().nullable(),
  situs_state: z.string().max(100).optional().nullable(),
});

export const createTrustRoleSchema = z.object({
  role: z.string().min(1, "Role is required").max(100),
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const createEntityRoleSchema = z.object({
  role_title: z.string().min(1, "Role title is required").max(255),
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const createCustomFieldSchema = z.object({
  label: z.string().min(1, "Label is required").max(255),
  field_type: z.string().min(1).max(50),
  value: z.string().max(5000).optional().nullable(),
});

// File upload validation
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.ms-excel", // .xls
]);

export function validateUploadedFile(file: File): { valid: true } | { valid: false; error: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File "${file.name}" exceeds the 50MB size limit` };
  }
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return { valid: false, error: `File type "${file.type}" is not allowed` };
  }
  return { valid: true };
}

export function validateFileMetadata(name: string, size: number, type: string): { valid: true } | { valid: false; error: string } {
  if (size > MAX_FILE_SIZE) {
    return { valid: false, error: `File "${name}" exceeds the 50MB size limit` };
  }
  if (type && !ALLOWED_MIME_TYPES.has(type)) {
    return { valid: false, error: `File type "${type}" is not allowed` };
  }
  return { valid: true };
}

export const presignRequestSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(500),
    size: z.number().int().positive().max(50 * 1024 * 1024),
    type: z.string().max(200),
  })).min(1).max(100),
});

export const registerUploadSchema = z.object({
  files: z.array(z.object({
    originalName: z.string().min(1).max(500),
    storagePath: z.string().min(1).max(1000),
    size: z.number().int().positive(),
    type: z.string().max(200),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(100),
});

// --- Investment schemas ---

export const createInvestmentSchema = z.object({
  // Deal metadata
  name: z.string().min(1, "Investment name is required").max(200),
  short_name: z.string().max(100).optional().or(z.literal("")),
  investment_type: z.enum(["real_estate", "startup", "fund", "private_equity", "debt", "other"]),
  status: z.enum(["active", "exited", "winding_down", "committed", "defaulted"]).default("active"),
  entity_id: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().or(z.literal("")),
  formation_state: z.string().max(50).optional().or(z.literal("")),
  date_invested: z.string().optional().or(z.literal("")),
  date_exited: z.string().optional().nullable(),
  preferred_return_pct: z.number().min(0).max(100).optional().nullable(),
  preferred_return_basis: z.enum(["capital_contributed", "capital_committed"]).optional().nullable(),
  // Investors — which internal entities are investing
  investors: z.array(z.object({
    entity_id: z.string().uuid(),
    capital_pct: z.number().min(0).max(100).optional().nullable(),
    profit_pct: z.number().min(0).max(100).optional().nullable(),
    committed_capital: z.number().min(0).optional().nullable(),
  })).min(1, "At least one investing entity is required"),
  // Co-investors — external parties
  co_investors: z.array(z.object({
    directory_entry_id: z.string().uuid(),
    role: z.enum(["co_investor", "promoter", "operator", "lender"]).default("co_investor"),
    capital_pct: z.number().min(0).max(100).optional().nullable(),
    profit_pct: z.number().min(0).max(100).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })).default([]),
});

export const updateInvestmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  short_name: z.string().max(100).optional().nullable(),
  investment_type: z.enum(["real_estate", "startup", "fund", "private_equity", "debt", "other"]).optional(),
  status: z.enum(["active", "exited", "winding_down", "committed", "defaulted"]).optional(),
  entity_id: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  formation_state: z.string().max(50).optional().nullable(),
  date_invested: z.string().optional().nullable(),
  date_exited: z.string().optional().nullable(),
  preferred_return_pct: z.number().min(0).max(100).optional().nullable(),
  preferred_return_basis: z.enum(["capital_contributed", "capital_committed"]).optional().nullable(),
});

// ============================================================
// Investment transaction line items (spec 036)
// ============================================================

export const transactionLineItemCategoryEnum = z.enum([
  // Contribution side
  "subscription",
  "management_fee",
  "monitoring_fee",
  "organizational_expense",
  "audit_tax_expense",
  "legal_expense",
  "late_fee",
  "other_contribution_expense",
  // Distribution side
  "gross_distribution",
  "operating_cashflows",
  "return_of_capital",
  "carried_interest",
  "compliance_holdback",
  "tax_withholding",
  "other_distribution_adjustment",
]);

export type TransactionLineItemCategory = z.infer<typeof transactionLineItemCategoryEnum>;

const CONTRIBUTION_CATEGORIES = new Set<TransactionLineItemCategory>([
  "subscription",
  "management_fee",
  "monitoring_fee",
  "organizational_expense",
  "audit_tax_expense",
  "legal_expense",
  "late_fee",
  "other_contribution_expense",
]);

const DISTRIBUTION_CATEGORIES = new Set<TransactionLineItemCategory>([
  "gross_distribution",
  "operating_cashflows",
  "return_of_capital",
  "carried_interest",
  "compliance_holdback",
  "tax_withholding",
  "other_distribution_adjustment",
]);

export const transactionLineItemSchema = z.object({
  category: transactionLineItemCategoryEnum,
  // Negative amounts permitted only on adjustment rows; the parent-level
  // refinement enforces that.
  amount: z.number(),
  description: z.string().max(500).nullable().optional(),
});

export type TransactionLineItemInput = z.infer<typeof transactionLineItemSchema>;

/**
 * Auto-coerce obvious category mistakes the AI extraction model commonly
 * makes, before running validation. The audit_tax_expense ↔ compliance_holdback
 * pair is by far the most frequent: the contribution-side `audit_tax_expense`
 * is for fees the LP is being charged on a capital call, while the
 * distribution-side `compliance_holdback` is for money the GP holds back from
 * a distribution to fund future audit/tax expenses. The names are similar
 * enough that the model picks the wrong side based on which one the column
 * header (e.g. "Audit/Tax Compliance Holdback") most closely matches.
 *
 * Coercion is logged via console.warn so we have visibility into how often
 * the model makes this mistake. Returns a NEW array — does not mutate.
 */
export function coerceLineItemCategories(
  transaction_type: "contribution" | "distribution" | "return_of_capital",
  line_items: TransactionLineItemInput[],
): TransactionLineItemInput[] {
  if (line_items.length === 0) return line_items;

  return line_items.map((li) => {
    // Wrong-side audit/tax category: distribution rows showing audit_tax_expense
    // are almost always meant to be compliance_holdback.
    if (transaction_type === "distribution" && li.category === "audit_tax_expense") {
      console.warn(
        `[validations] coerced audit_tax_expense → compliance_holdback on a distribution row ` +
        `(amount: ${li.amount}, description: ${li.description || "null"})`
      );
      return { ...li, category: "compliance_holdback" as const };
    }
    // Reverse direction: contribution rows showing compliance_holdback are
    // almost always meant to be audit_tax_expense (an LP-side fee).
    if (transaction_type === "contribution" && li.category === "compliance_holdback") {
      console.warn(
        `[validations] coerced compliance_holdback → audit_tax_expense on a contribution row ` +
        `(amount: ${li.amount}, description: ${li.description || "null"})`
      );
      return { ...li, category: "audit_tax_expense" as const };
    }
    return li;
  });
}

/**
 * Shared validator used by both HTTP routes (manual transaction entry) and
 * the AI apply pipeline. Returns null on success or an error string. Keeping
 * this in one place prevents drift between the routes and apply.ts.
 *
 * Rules:
 *   - Categories must match the parent transaction_type side.
 *   - Adjustment rows (adjusts_transaction_id != null) MAY contain negative
 *     amounts; non-adjustment rows must have positive amounts on every line.
 *   - Sum reconciliation:
 *       contribution: sum(line_items) == amount
 *       distribution: gross_distribution - sum(reductions) == amount
 *     Both within $0.01 to absorb rounding.
 *   - Empty line_items is always allowed (back-compat: API derivations fall
 *     back to "100% subscription" / "100% gross").
 */
export function validateInvestmentTransactionLineItems(input: {
  transaction_type: "contribution" | "distribution" | "return_of_capital";
  amount: number;
  line_items: TransactionLineItemInput[];
  adjusts_transaction_id?: string | null;
}): { ok: true } | { ok: false; error: string } {
  const { transaction_type, amount, line_items } = input;
  const isAdjustment = !!input.adjusts_transaction_id;

  if (line_items.length === 0) return { ok: true };

  // Negative amounts only allowed on adjustment rows.
  if (!isAdjustment) {
    for (const li of line_items) {
      if (li.amount < 0) {
        return { ok: false, error: "line_items may only contain negative amounts on adjustment rows" };
      }
    }
  }

  // Category-side enforcement.
  const expected =
    transaction_type === "contribution" ? CONTRIBUTION_CATEGORIES :
    transaction_type === "distribution" ? DISTRIBUTION_CATEGORIES :
    null;

  if (expected) {
    for (const li of line_items) {
      if (!expected.has(li.category)) {
        return {
          ok: false,
          error: `line_items category "${li.category}" is not legal under transaction_type "${transaction_type}"`,
        };
      }
    }
  } else if (transaction_type === "return_of_capital") {
    // Top-level RoC is the all-or-nothing case; line_items not supported.
    return { ok: false, error: "transaction_type 'return_of_capital' does not support line_items" };
  }

  // Sum reconciliation.
  if (transaction_type === "contribution") {
    const sum = line_items.reduce((s, li) => s + li.amount, 0);
    if (Math.abs(sum - amount) > 0.01) {
      return { ok: false, error: `line_items sum (${sum.toFixed(2)}) does not equal amount (${amount.toFixed(2)})` };
    }
  } else if (transaction_type === "distribution") {
    const grossLines = line_items.filter((li) => li.category === "gross_distribution");
    // Adjustment rows may legitimately omit gross_distribution if the
    // adjustment only touches reductions (e.g., a recall of withholding).
    // For non-adjustment rows we still require a gross line.
    if (grossLines.length === 0 && !isAdjustment) {
      return { ok: false, error: "distribution line_items must contain at least one 'gross_distribution' line" };
    }
    const gross = grossLines.reduce((s, li) => s + li.amount, 0);
    const reductions = line_items
      .filter((li) => li.category !== "gross_distribution")
      .reduce((s, li) => s + li.amount, 0);
    const net = gross - reductions;
    if (Math.abs(net - amount) > 0.01) {
      return {
        ok: false,
        error: `distribution net (gross ${gross.toFixed(2)} - reductions ${reductions.toFixed(2)} = ${net.toFixed(2)}) does not equal amount (${amount.toFixed(2)})`,
      };
    }
  }

  return { ok: true };
}

export const createInvestmentTransactionSchema = z.object({
  investment_investor_id: z.string().uuid("Investor position is required"),
  transaction_type: z.enum(["contribution", "distribution", "return_of_capital"]),
  // Adjustments may carry negative amounts; non-adjustments must be positive.
  // The cross-field check is in the .superRefine below.
  amount: z.number(),
  transaction_date: z.string().min(1, "Date is required"),
  description: z.string().max(500).optional().or(z.literal("")),
  document_id: z.string().uuid().optional().nullable(),
  split_by_allocation: z.boolean().default(true),
  member_amounts: z.array(z.object({
    member_directory_id: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
  // Spec 036 additions.
  line_items: z.array(transactionLineItemSchema).default([]),
  adjusts_transaction_id: z.string().uuid().nullable().optional(),
  adjustment_reason: z.string().max(1000).nullable().optional(),
}).superRefine((data, ctx) => {
  const isAdjustment = !!data.adjusts_transaction_id;
  if (!isAdjustment && data.amount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be positive", path: ["amount"] });
  }
  const result = validateInvestmentTransactionLineItems({
    transaction_type: data.transaction_type,
    amount: data.amount,
    line_items: data.line_items,
    adjusts_transaction_id: data.adjusts_transaction_id ?? null,
  });
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error, path: ["line_items"] });
  }
});
