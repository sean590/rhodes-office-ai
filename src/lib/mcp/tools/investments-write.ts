/**
 * Investment-domain write tools — 13 tools.
 *
 * create_investment, update_investment, archive_investment,
 * add_investment_investor, update_investment_investor, remove_investment_investor,
 * add_co_investor, update_co_investor, remove_co_investor,
 * record_investment_transaction, update_investment_transaction,
 * delete_investment_transaction, set_investment_allocations.
 *
 * Line-item validation:
 *   record/update_investment_transaction descriptions enumerate the allowed
 *   categories per transaction type, matching apply.ts coerceLineItemCategories.
 *
 * Allocation rule:
 *   set_investment_allocations explicitly permits partial allocations
 *   (sum < 100%). Sum > 100% is rejected.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { dispatchAction } from "../apply-dispatch";
import { resolveName } from "../resolve-names";

const LINE_ITEM_DESC = [
  "Contribution categories: subscription, management_fee, monitoring_fee,",
  "organizational_expense, audit_tax_expense, legal_expense, late_fee,",
  "other_contribution_expense.",
  "Distribution categories: gross_distribution, operating_cashflows,",
  "return_of_capital, carried_interest, compliance_holdback, tax_withholding,",
  "other_distribution_adjustment.",
  "Contributions: line_items must sum exactly to amount.",
  "Distributions: gross_distribution minus reductions must equal net amount.",
].join(" ");

const lineItemSchema = z.object({
  category: z.string(),
  amount: z.number(),
  description: z.string().optional().nullable(),
});

// --- create_investment -------------------------------------------------------

export const createInvestmentTool = defineTool({
  name: "create_investment",
  description: "Create a new investment (deal). The investing entity is linked via a separate add_investment_investor call.",
  kind: "write",
  inputSchema: z.object({
    name: z.string().min(1),
    short_name: z.string().optional().nullable(),
    investment_type: z.enum(["real_estate", "startup", "fund", "private_equity", "debt", "other"]),
    parent_entity_id: z.string().uuid().optional().nullable().describe("The internal entity making the initial investment — creates an investment_investor row."),
    capital_pct: z.number().optional().nullable(),
    profit_pct: z.number().optional().nullable(),
    committed_capital: z.number().optional().nullable(),
    formation_state: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    preferred_return_pct: z.number().optional().nullable(),
  }),
  dryRun: async (input) => ({
    summary: `Create investment: ${input.name} (${input.investment_type})`,
    preview: input,
  }),
  handler: async (input, ctx) => {
    if (input.parent_entity_id) {
      await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.parent_entity_id });
    }
    const result = await dispatchAction(ctx, "create_investment", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- update_investment -------------------------------------------------------

export const updateInvestmentTool = defineTool({
  name: "update_investment",
  description: "Update fields on an existing investment (name, type, status, description, dates).",
  kind: "write",
  inputSchema: z.object({
    investment_id: z.string().uuid(),
    name: z.string().optional(),
    short_name: z.string().optional().nullable(),
    investment_type: z.enum(["real_estate", "startup", "fund", "private_equity", "debt", "other"]).optional(),
    status: z.enum(["active", "exited", "winding_down", "committed", "defaulted"]).optional(),
    description: z.string().optional().nullable(),
    formation_state: z.string().optional().nullable(),
    date_invested: z.string().optional().nullable(),
    date_exited: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const name = await resolveName(ctx, "investment", input.investment_id);
    return { summary: `Update ${name}`, preview: input };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    // Investments have their own table (Investments v3, migration 027+);
    // we no longer route through update_entity. The apply.ts case
    // "update_investment" reads the flat shape this tool emits.
    const result = await dispatchAction(ctx, "update_investment", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- archive_investment ------------------------------------------------------

export const archiveInvestmentTool = defineTool({
  name: "archive_investment",
  capability: "records:delete",
  description: "Set an investment's status to 'exited'.",
  kind: "write",
  inputSchema: z.object({ investment_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const name = await resolveName(ctx, "investment", input.investment_id);
    return { summary: `Archive ${name} (set status to exited)` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const result = await dispatchAction(ctx, "update_investment", {
      investment_id: input.investment_id,
      status: "exited",
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Investment investors (add, update, remove) ------------------------------

export const addInvestmentInvestorTool = defineTool({
  name: "add_investment_investor",
  description: "Add an internal entity as an investor on an existing investment. Reactivates if a prior row exists and is inactive.",
  kind: "write",
  inputSchema: z.object({
    investment_id: z.string().uuid(),
    entity_id: z.string().uuid(),
    committed_capital: z.number().optional().nullable(),
    capital_pct: z.number().optional().nullable(),
    profit_pct: z.number().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const [entityName, invName] = await Promise.all([
      resolveName(ctx, "entity", input.entity_id),
      resolveName(ctx, "investment", input.investment_id),
    ]);
    return { summary: `Add ${entityName} as investor on ${invName}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "add_investment_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateInvestmentInvestorTool = defineTool({
  name: "update_investment_investor",
  description: "Update committed capital or share percentages on an investment-investor position.",
  kind: "write",
  inputSchema: z.object({
    investment_investor_id: z.string().uuid(),
    committed_capital: z.number().optional().nullable(),
    capital_pct: z.number().optional().nullable(),
    profit_pct: z.number().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_investor", resourceId: input.investment_investor_id });
    const name = await resolveName(ctx, "investment_investor", input.investment_investor_id);
    return { summary: `Update investor position for ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_investor", resourceId: input.investment_investor_id });
    const result = await dispatchAction(ctx, "update_investment_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const removeInvestmentInvestorTool = defineTool({
  name: "remove_investment_investor",
  description: "Soft-remove an investor from a deal (set is_active=false). Refuses if this is the last active investor.",
  kind: "write",
  inputSchema: z.object({ investment_investor_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_investor", resourceId: input.investment_investor_id });
    const name = await resolveName(ctx, "investment_investor", input.investment_investor_id);
    return { summary: `Remove investor ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_investor", resourceId: input.investment_investor_id });
    const result = await dispatchAction(ctx, "remove_investment_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Co-investors (add, update, remove) --------------------------------------

export const addCoInvestorTool = defineTool({
  name: "add_co_investor",
  description: "Add an external party (directory entry) to an investment as a co-investor, promoter, operator, or lender.",
  kind: "write",
  inputSchema: z.object({
    investment_id: z.string().uuid(),
    directory_entry_id: z.string().uuid(),
    role: z.enum(["co_investor", "promoter", "operator", "lender"]),
    capital_pct: z.number().optional().nullable(),
    profit_pct: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const invName = await resolveName(ctx, "investment", input.investment_id);
    return { summary: `Add co-investor (${input.role}) to ${invName}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const result = await dispatchAction(ctx, "add_co_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateCoInvestorTool = defineTool({
  name: "update_co_investor",
  description: "Update a co-investor's role, share percentages, or notes.",
  kind: "write",
  inputSchema: z.object({
    co_investor_id: z.string().uuid(),
    role: z.enum(["co_investor", "promoter", "operator", "lender"]).optional(),
    capital_pct: z.number().optional().nullable(),
    profit_pct: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_co_investor", resourceId: input.co_investor_id });
    const name = await resolveName(ctx, "investment_co_investor", input.co_investor_id);
    return { summary: `Update co-investor ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_co_investor", resourceId: input.co_investor_id });
    const result = await dispatchAction(ctx, "update_co_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const removeCoInvestorTool = defineTool({
  name: "remove_co_investor",
  description: "Hard-delete a co-investor from an investment.",
  kind: "write",
  inputSchema: z.object({ co_investor_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_co_investor", resourceId: input.co_investor_id });
    const name = await resolveName(ctx, "investment_co_investor", input.co_investor_id);
    return { summary: `Remove co-investor ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_co_investor", resourceId: input.co_investor_id });
    const result = await dispatchAction(ctx, "remove_co_investor", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Transactions (record, update, delete) -----------------------------------

export const recordInvestmentTransactionTool = defineTool({
  name: "record_investment_transaction",
  description:
    `Record a capital call (contribution) or distribution on an investment. ${LINE_ITEM_DESC}`,
  kind: "write",
  inputSchema: z.object({
    investment_id: z.string().uuid(),
    parent_entity_id: z.string().uuid().optional().describe(
      "The internal entity whose position this transaction belongs to. " +
      "REQUIRED when the investment has more than one active investor — the apply path " +
      "cannot infer which investor's books the transaction lands on otherwise. Optional when " +
      "the investment has exactly one investor (it will be auto-selected). Check active investor " +
      "count via get_investment_summary's active_investor_count field before calling.",
    ),
    transaction_type: z.enum(["contribution", "distribution", "return_of_capital"]),
    amount: z.number(),
    transaction_date: z.string(),
    description: z.string().optional().nullable(),
    split_by_allocation: z.boolean().optional(),
    line_items: z.array(lineItemSchema).optional(),
    document_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Source document for this transaction (e.g., the distribution notice or capital-call statement). When set, the transaction's source-document link is populated; the UI shows a clickable link to the doc on the transaction row.",
      ),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    return {
      summary: `Record ${input.transaction_type} of $${input.amount.toLocaleString()} on ${await resolveName(ctx, "investment", input.investment_id)} dated ${input.transaction_date}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const result = await dispatchAction(ctx, "record_investment_transaction", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateInvestmentTransactionTool = defineTool({
  name: "update_investment_transaction",
  description:
    `Correct an existing transaction — amount, date, type, investor assignment, line items, or attach a source document via document_id. ${LINE_ITEM_DESC}`,
  kind: "write",
  inputSchema: z.object({
    transaction_id: z.string().uuid(),
    investment_investor_id: z.string().uuid().optional(),
    transaction_type: z.enum(["contribution", "distribution"]).optional(),
    amount: z.number().optional(),
    transaction_date: z.string().optional(),
    line_items: z.array(lineItemSchema).optional(),
    notes: z.string().optional().nullable(),
    document_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Attach (or replace) the source document for this transaction. The most common use of update_investment_transaction in chat is exactly this: a doc was uploaded after the transaction was recorded, and now the user wants the transaction row to link to it. Pass the document_id and just transaction_id — no other fields needed.",
      ),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_transaction", resourceId: input.transaction_id });

    // Pull current row so we can render a change list ("attach <doc>",
    // "set amount to $X") instead of a vague "Update distribution
    // transaction". The user reads the staged-actions card to decide
    // whether to approve — opaque summaries force them to click into
    // each row.
    const { data: existing } = await ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_id, investment_investor_id, document_id")
      .eq("id", input.transaction_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();

    const txnType = (input.transaction_type ?? existing?.transaction_type ?? "transaction") as string;
    const txnDate = existing?.transaction_date as string | undefined;
    const investmentName = existing?.investment_id
      ? await resolveName(ctx, "investment", existing.investment_id as string)
      : null;

    const parts: string[] = [];
    if (input.document_id) {
      const docName = await resolveName(ctx, "document", input.document_id);
      parts.push(`attach "${docName}"`);
    }
    if (input.amount !== undefined && input.amount !== existing?.amount) {
      parts.push(`set amount to $${input.amount.toLocaleString()}`);
    }
    if (input.transaction_date && input.transaction_date !== existing?.transaction_date) {
      parts.push(`set date to ${input.transaction_date}`);
    }
    if (input.transaction_type && input.transaction_type !== existing?.transaction_type) {
      parts.push(`reclassify as ${input.transaction_type}`);
    }
    if (input.investment_investor_id && input.investment_investor_id !== existing?.investment_investor_id) {
      const investorName = await resolveName(ctx, "investment_investor", input.investment_investor_id);
      parts.push(`reassign to ${investorName}`);
    }
    if (input.line_items !== undefined) {
      parts.push(`update line items (${input.line_items.length})`);
    }
    if (input.notes !== undefined) {
      parts.push(input.notes ? "update notes" : "clear notes");
    }

    const subject = investmentName
      ? `${txnType} on ${investmentName}${txnDate ? ` (${txnDate})` : ""}`
      : `${txnType} transaction`;
    const summary = parts.length === 0
      ? `Update ${subject}`
      : parts.length === 1
        ? `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)} — ${subject}`
        : `Update ${subject}: ${parts.join(", ")}`;

    return { summary, preview: input };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_transaction", resourceId: input.transaction_id });
    const result = await dispatchAction(ctx, "update_investment_transaction", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const deleteInvestmentTransactionTool = defineTool({
  name: "delete_investment_transaction",
  capability: "records:delete",
  description: "Hard-delete a transaction that was recorded in error. For corrections, prefer update_investment_transaction.",
  kind: "write",
  inputSchema: z.object({ transaction_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_transaction", resourceId: input.transaction_id });

    // Pull the row so the user can see WHICH transaction is being deleted —
    // investor + amount + date — instead of an opaque "Delete distribution
    // transaction" line. Deletes are unrecoverable so the staged-actions
    // card needs to be unambiguous.
    const { data: existing } = await ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_id, investment_investor_id")
      .eq("id", input.transaction_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();

    if (!existing) {
      return { summary: `Delete transaction ${input.transaction_id.slice(0, 8)}…` };
    }

    const txnType = existing.transaction_type as string;
    const amount = existing.amount;
    const amountStr = amount != null
      ? `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;
    const investmentName = existing.investment_id
      ? await resolveName(ctx, "investment", existing.investment_id as string)
      : null;
    const investorName = existing.investment_investor_id
      ? await resolveName(ctx, "investment_investor", existing.investment_investor_id as string)
      : null;

    const bits: string[] = [];
    if (amountStr) bits.push(amountStr);
    if (investorName) bits.push(`to ${investorName}`);
    if (investmentName) bits.push(`on ${investmentName}`);
    if (existing.transaction_date) bits.push(`(${existing.transaction_date})`);

    const summary = bits.length > 0
      ? `Delete ${txnType} ${bits.join(" ")}`
      : `Delete ${txnType} transaction`;
    return { summary };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment_transaction", resourceId: input.transaction_id });
    const result = await dispatchAction(ctx, "delete_investment_transaction", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Allocations -------------------------------------------------------------

export const setInvestmentAllocationsTool = defineTool({
  name: "set_investment_allocations",
  description:
    "Set internal member-level allocation splits for an investor position. Partial allocations (sum < 100%) are valid and intentional — do NOT invent filler entries to reach 100%. Sum > 100% is rejected.",
  kind: "write",
  inputSchema: z.object({
    investment_id: z.string().uuid(),
    parent_entity_id: z.string().uuid(),
    allocations: z.array(z.object({
      member_name: z.string(),
      allocation_pct: z.number(),
      committed_amount: z.number().optional().nullable(),
    })),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const totalPct = input.allocations.reduce((s, a) => s + a.allocation_pct, 0);
    return {
      summary: `Set ${input.allocations.length} allocations (${totalPct}% total) on ${await resolveName(ctx, "investment", input.investment_id)}`,
      preview: input.allocations,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const result = await dispatchAction(ctx, "set_investment_allocations", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// Suppress the unused import lint when LINE_ITEM_DESC is the only consumer.
void LINE_ITEM_DESC;

export const investmentWriteTools: ToolDefinition[] = [
  createInvestmentTool,
  updateInvestmentTool,
  archiveInvestmentTool,
  addInvestmentInvestorTool,
  updateInvestmentInvestorTool,
  removeInvestmentInvestorTool,
  addCoInvestorTool,
  updateCoInvestorTool,
  removeCoInvestorTool,
  recordInvestmentTransactionTool,
  updateInvestmentTransactionTool,
  deleteInvestmentTransactionTool,
  setInvestmentAllocationsTool,
];
