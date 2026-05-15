/**
 * Investment-domain MCP tools.
 *
 * Investments carry organization_id, so top-level tools gate on ctx.orgId
 * directly. Child resources (investors, co-investors, transactions,
 * allocations) route through verifyInvestmentBelongsToOrg first — the same
 * pattern as entity-scoped tools.
 */

import { z } from "zod";
import { defineTool, MAX_LIST_ROWS, type ToolDefinition } from "../schema";
import { verifyInvestmentBelongsToOrg, ToolError } from "../tool-helpers";

const INVESTMENT_TYPES = [
  "real_estate",
  "startup",
  "fund",
  "private_equity",
  "debt",
  "other",
] as const;

const INVESTMENT_STATUSES = [
  "active",
  "exited",
  "winding_down",
  "committed",
  "defaulted",
] as const;

// --- list_investments --------------------------------------------------------

// `investments.parent_entity_id` was dropped in migration 032 — the
// parent-investor relationship moved to the `investment_investors` join
// table. Use `investor_entity_id` to ask "deals involving this entity."
// There is no longer a direct column on `investments` for this.
const listInvestmentsInput = z.object({
  name_query: z
    .string()
    .optional()
    .describe(
      "Case-insensitive substring match on investment name (e.g., 'Silverhawk' matches 'Silverhawk Incline Energy I'). Pass the most distinctive token, not the full name.",
    ),
  investment_type: z.enum(INVESTMENT_TYPES).optional(),
  status: z.enum(INVESTMENT_STATUSES).optional(),
  investor_entity_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Return investments where this entity appears as an active investor in the investment_investors table. This is how to scope deals to an internal entity — there is no longer a parent_entity column on investments itself.",
    ),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

export const listInvestmentsTool = defineTool({
  name: "list_investments",
  description:
    "List investments (deals) in the user's organization. Returns id, name, short_name, investment_type, status, date_invested, date_exited, formation_state — DOES NOT return investor information. " +
    "To see who invests in a deal: call get_investment for that deal, or filter this list with investor_entity_id to find deals a given entity invests in. " +
    "The absence of investor data in this response does NOT mean a deal has no investors — this tool simply doesn't return that field. " +
    "Filter params: name_query (substring match on name), investment_type, status, investor_entity_id (deals where a specific internal entity is an active investor). Default limit 25.",
  kind: "read",
  inputSchema: listInvestmentsInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;

    // When filtering by investor entity, first resolve the investment_ids via
    // investment_investors (is_active=true), then scope the main query.
    let restrictInvestmentIds: string[] | null = null;
    if (args.investor_entity_id) {
      const { data, error } = await ctx.supabase
        .from("investment_investors")
        .select("investment_id")
        .eq("organization_id", ctx.orgId)
        .eq("entity_id", args.investor_entity_id)
        .eq("is_active", true);
      if (error) throw error;
      restrictInvestmentIds = (data ?? []).map(
        (r: { investment_id: string }) => r.investment_id,
      );
      if (restrictInvestmentIds.length === 0) {
        return { data: [], truncated: false };
      }
    }

    let query = ctx.supabase
      .from("investments")
      .select(
        // entity_id (legacy column from before investment_investors existed —
        // see migration 032) intentionally excluded: it's null on every row
        // post-migration and the field name was misleading the orchestrator
        // into inferring "no investor linked" for every deal. Investor info
        // lives in investment_investors and is exposed via get_investment.
        "id, name, short_name, investment_type, status, date_invested, date_exited, formation_state",
      )
      .eq("organization_id", ctx.orgId)
      .order("name")
      .limit(limit + 1);

    if (args.name_query) query = query.ilike("name", `%${args.name_query}%`);
    if (args.investment_type) query = query.eq("investment_type", args.investment_type);
    if (args.status) query = query.eq("status", args.status);
    if (restrictInvestmentIds) query = query.in("id", restrictInvestmentIds);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > limit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, limit) : rows),
      truncated,
    };
  },
});

// --- get_investment ----------------------------------------------------------

const getInvestmentInput = z.object({ investment_id: z.string().uuid() });

export const getInvestmentTool = defineTool({
  name: "get_investment",
  description:
    "Full record for one investment, including active investors (investment_investors), external co-investors (investment_co_investors), and summary totals (committed, contributed, distributed). Use list_investment_transactions for the itemized cash-flow history.",
  kind: "read",
  inputSchema: getInvestmentInput,
  handler: async ({ investment_id }, ctx) => {
    // Primary fetch is the ownership gate — if not present in ctx.orgId, we
    // return not_found rather than leaking an existence signal.
    const { data: inv, error } = await ctx.supabase
      .from("investments")
      .select("*")
      .eq("id", investment_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!inv) throw new ToolError("not_found", `investment ${investment_id} not found`);

    // All three child tables carry organization_id — belt-and-suspenders.
    const [investorsRes, coInvestorsRes, txnsRes] = await Promise.all([
      ctx.supabase
        .from("investment_investors")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .eq("investment_id", investment_id)
        .eq("is_active", true)
        .order("created_at"),
      ctx.supabase
        .from("investment_co_investors")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .eq("investment_id", investment_id)
        .order("created_at"),
      ctx.supabase
        .from("investment_transactions")
        .select("transaction_type, amount")
        .eq("organization_id", ctx.orgId)
        .eq("investment_id", investment_id),
    ]);
    if (investorsRes.error) throw investorsRes.error;
    if (coInvestorsRes.error) throw coInvestorsRes.error;
    if (txnsRes.error) throw txnsRes.error;

    // Roll up contributions and distributions in JS — this is a small-N list,
    // not a portfolio aggregation. Aggregation tools (Phase 1 PR 5) do the
    // SQL-SUM variant at scale.
    let contributed = 0;
    let distributed = 0;
    let returnOfCapital = 0;
    for (const t of (txnsRes.data ?? []) as Array<{
      transaction_type: string;
      amount: number | string | null;
    }>) {
      const amt = Number(t.amount) || 0;
      if (t.transaction_type === "contribution") contributed += amt;
      else if (t.transaction_type === "distribution") distributed += amt;
      else if (t.transaction_type === "return_of_capital") returnOfCapital += amt;
    }

    const committed = (investorsRes.data ?? []).reduce(
      (sum: number, r: { committed_capital: number | string | null }) =>
        sum + (Number(r.committed_capital) || 0),
      0,
    );

    return {
      data: ctx.redact({
        ...inv,
        investors: investorsRes.data ?? [],
        co_investors: coInvestorsRes.data ?? [],
        totals: {
          committed,
          contributed,
          distributed,
          return_of_capital: returnOfCapital,
          net_cash_flow: distributed + returnOfCapital - contributed,
          transaction_count: (txnsRes.data ?? []).length,
        },
      }),
    };
  },
});

// --- list_investment_transactions --------------------------------------------

const listInvestmentTransactionsInput = z.object({
  investment_id: z.string().uuid(),
  investment_investor_id: z.string().uuid().optional(),
  transaction_type: z
    .enum(["contribution", "distribution", "return_of_capital"])
    .optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(50),
});

export const listInvestmentTransactionsTool = defineTool({
  name: "list_investment_transactions",
  description:
    "List capital calls, distributions, and return-of-capital rows for one investment. Supports filters by investor, type, and date range. Default limit 50.",
  kind: "read",
  inputSchema: listInvestmentTransactionsInput,
  handler: async (args, ctx) => {
    await verifyInvestmentBelongsToOrg(ctx, args.investment_id);
    const limit = args.limit ?? 50;
    let query = ctx.supabase
      .from("investment_transactions")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("investment_id", args.investment_id)
      .order("transaction_date", { ascending: false })
      .limit(limit + 1);

    if (args.investment_investor_id)
      query = query.eq("investment_investor_id", args.investment_investor_id);
    if (args.transaction_type) query = query.eq("transaction_type", args.transaction_type);
    if (args.date_from) query = query.gte("transaction_date", args.date_from);
    if (args.date_to) query = query.lte("transaction_date", args.date_to);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > limit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, limit) : rows),
      truncated,
    };
  },
});

// --- get_investment_allocations ----------------------------------------------

const getInvestmentAllocationsInput = z.object({
  investment_investor_id: z.string().uuid(),
});

export const getInvestmentAllocationsTool = defineTool({
  name: "get_investment_allocations",
  description:
    "Return the active member-level allocation splits under one investment-investor stake. Each row names a directory entry and its allocation_pct of that investor's position.",
  kind: "read",
  inputSchema: getInvestmentAllocationsInput,
  handler: async ({ investment_investor_id }, ctx) => {
    // Ownership gate via the parent investment_investors row.
    const { data: ii, error: iiErr } = await ctx.supabase
      .from("investment_investors")
      .select("id, investment_id, organization_id")
      .eq("id", investment_investor_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (iiErr) throw iiErr;
    if (!ii)
      throw new ToolError(
        "not_found",
        `investment_investor ${investment_investor_id} not found`,
      );

    const { data, error } = await ctx.supabase
      .from("investment_allocations")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("investment_investor_id", investment_investor_id)
      .eq("is_active", true)
      .order("allocation_pct", { ascending: false });
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

export const investmentTools: ToolDefinition[] = [
  listInvestmentsTool,
  getInvestmentTool,
  listInvestmentTransactionsTool,
  getInvestmentAllocationsTool,
];
