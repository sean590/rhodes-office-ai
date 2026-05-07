/**
 * Aggregation MCP tools — the first-class path for "how much/how many" questions.
 *
 * Design rules from the spec:
 * - Return a single object (not an array of rows).
 * - Include the period/filters in the response so Claude can cite them.
 * - Include counts alongside totals ({ total: X, count: N }).
 * - Default to all-time if date filters are missing.
 *
 * IMPLEMENTATION NOTE — Phase 1 sums in JS inside each handler, over a single
 * filtered query per tool. The spec's prohibition on "summing list-tool
 * results" is about preventing Claude from doing that at the orchestrator
 * level; inside a single aggregation tool, a scoped row reduce is the same
 * big-O cost as a SQL SUM. When per-org scale justifies it, move the reduce
 * to Postgres RPCs — the handler boundary stays the same. Callers never see
 * the change.
 *
 * Every handler uses ctx.orgId for scoping; entity/investment-scoped variants
 * run their ownership gate first.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import {
  verifyEntityBelongsToOrg,
  verifyInvestmentBelongsToOrg,
  ToolError,
  todayIsoUtc,
  isoDateOffsetUtc,
} from "../tool-helpers";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// --- Shared helpers ---------------------------------------------------------

interface TxnRow {
  transaction_type: string;
  amount: number | string | null;
  transaction_date: string | null;
  investment_investor_id: string | null;
  investment_id: string | null;
}

function sumTxnsByType(rows: TxnRow[]) {
  let contributed = 0;
  let distributed = 0;
  let returnOfCapital = 0;
  let contributionCount = 0;
  let distributionCount = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (r.transaction_type === "contribution") {
      contributed += amt;
      contributionCount++;
    } else if (r.transaction_type === "distribution") {
      distributed += amt;
      distributionCount++;
    } else if (r.transaction_type === "return_of_capital") {
      returnOfCapital += amt;
      distributionCount++;
    }
  }
  return {
    contributed,
    distributed,
    return_of_capital: returnOfCapital,
    net_cash_flow: distributed + returnOfCapital - contributed,
    contribution_count: contributionCount,
    distribution_count: distributionCount,
    transaction_count: rows.length,
  };
}

// --- get_investment_summary --------------------------------------------------

const getInvestmentSummaryInput = z.object({
  investment_id: z.string().uuid(),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
});

export const getInvestmentSummaryTool = defineTool({
  name: "get_investment_summary",
  description:
    "Totals for one investment: committed (across active investors), contributed, distributed, return_of_capital, net_cash_flow, counts by type. Optional date_from / date_to clips the window.",
  kind: "read",
  inputSchema: getInvestmentSummaryInput,
  handler: async (args, ctx) => {
    await verifyInvestmentBelongsToOrg(ctx, args.investment_id);

    // Both tables carry organization_id — belt-and-suspenders per
    // tool-helpers.ts.
    let txnQuery = ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
      .eq("organization_id", ctx.orgId)
      .eq("investment_id", args.investment_id);
    if (args.date_from) txnQuery = txnQuery.gte("transaction_date", args.date_from);
    if (args.date_to) txnQuery = txnQuery.lte("transaction_date", args.date_to);

    const [txnRes, investorsRes] = await Promise.all([
      txnQuery,
      ctx.supabase
        .from("investment_investors")
        .select("committed_capital")
        .eq("organization_id", ctx.orgId)
        .eq("investment_id", args.investment_id)
        .eq("is_active", true),
    ]);
    if (txnRes.error) throw txnRes.error;
    if (investorsRes.error) throw investorsRes.error;

    const txns = (txnRes.data ?? []) as TxnRow[];
    const investors = (investorsRes.data ?? []) as Array<{ committed_capital: number | string | null }>;
    const committed = investors.reduce(
      (s, r) => s + (Number(r.committed_capital) || 0),
      0,
    );

    return {
      data: {
        investment_id: args.investment_id,
        period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
        committed,
        // Surfaced so write tools (especially record_investment_transaction)
        // can decide whether parent_entity_id is required: > 1 means yes.
        active_investor_count: investors.length,
        ...sumTxnsByType(txns),
      },
    };
  },
});

// --- get_investment_investor_summary -----------------------------------------

const getInvestmentInvestorSummaryInput = z.object({
  investment_investor_id: z.string().uuid(),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
});

export const getInvestmentInvestorSummaryTool = defineTool({
  name: "get_investment_investor_summary",
  description:
    "Same totals as get_investment_summary but for a single investor's stake in one deal.",
  kind: "read",
  inputSchema: getInvestmentInvestorSummaryInput,
  handler: async (args, ctx) => {
    const { data: ii, error: iiErr } = await ctx.supabase
      .from("investment_investors")
      .select("id, investment_id, committed_capital")
      .eq("id", args.investment_investor_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (iiErr) throw iiErr;
    if (!ii)
      throw new ToolError(
        "not_found",
        `investment_investor ${args.investment_investor_id} not found`,
      );

    let txnQuery = ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
      .eq("organization_id", ctx.orgId)
      .eq("investment_investor_id", args.investment_investor_id);
    if (args.date_from) txnQuery = txnQuery.gte("transaction_date", args.date_from);
    if (args.date_to) txnQuery = txnQuery.lte("transaction_date", args.date_to);

    const { data, error } = await txnQuery;
    if (error) throw error;

    return {
      data: {
        investment_investor_id: args.investment_investor_id,
        investment_id: ii.investment_id,
        period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
        committed: Number(ii.committed_capital) || 0,
        ...sumTxnsByType((data ?? []) as TxnRow[]),
      },
    };
  },
});

// --- get_entity_investment_summary -------------------------------------------

const getEntityInvestmentSummaryInput = z.object({
  entity_id: z.string().uuid(),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
});

export const getEntityInvestmentSummaryTool = defineTool({
  name: "get_entity_investment_summary",
  description:
    "Across every active deal the entity invests in: total committed, contributed, distributed, and per-investment breakdown. The entity is identified as an investor via investment_investors.entity_id.",
  kind: "read",
  inputSchema: getEntityInvestmentSummaryInput,
  handler: async (args, ctx) => {
    await verifyEntityBelongsToOrg(ctx, args.entity_id);

    const { data: stakes, error: stakesErr } = await ctx.supabase
      .from("investment_investors")
      .select("id, investment_id, committed_capital")
      .eq("organization_id", ctx.orgId)
      .eq("entity_id", args.entity_id)
      .eq("is_active", true);
    if (stakesErr) throw stakesErr;

    const stakeIds = (stakes ?? []).map((s: { id: string }) => s.id);
    if (stakeIds.length === 0) {
      return {
        data: {
          entity_id: args.entity_id,
          period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
          committed: 0,
          ...sumTxnsByType([]),
          investment_count: 0,
          by_investment: [],
        },
      };
    }

    let txnQuery = ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
      .eq("organization_id", ctx.orgId)
      .in("investment_investor_id", stakeIds);
    if (args.date_from) txnQuery = txnQuery.gte("transaction_date", args.date_from);
    if (args.date_to) txnQuery = txnQuery.lte("transaction_date", args.date_to);
    const { data: txns, error: txnErr } = await txnQuery;
    if (txnErr) throw txnErr;

    // Per-investment rollup
    const byInv = new Map<string, TxnRow[]>();
    for (const t of (txns ?? []) as TxnRow[]) {
      const key = t.investment_id ?? "";
      if (!byInv.has(key)) byInv.set(key, []);
      byInv.get(key)!.push(t);
    }
    const committedByInv = new Map<string, number>();
    for (const s of (stakes ?? []) as Array<{
      investment_id: string;
      committed_capital: number | string | null;
    }>) {
      committedByInv.set(
        s.investment_id,
        (committedByInv.get(s.investment_id) ?? 0) + (Number(s.committed_capital) || 0),
      );
    }

    const byInvestment = Array.from(committedByInv.keys()).map((investmentId) => ({
      investment_id: investmentId,
      committed: committedByInv.get(investmentId) ?? 0,
      ...sumTxnsByType(byInv.get(investmentId) ?? []),
    }));

    return {
      data: {
        entity_id: args.entity_id,
        period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
        committed: Array.from(committedByInv.values()).reduce((a, b) => a + b, 0),
        ...sumTxnsByType((txns ?? []) as TxnRow[]),
        investment_count: committedByInv.size,
        by_investment: byInvestment,
      },
    };
  },
});

// --- get_portfolio_summary ---------------------------------------------------

const getPortfolioSummaryInput = z.object({
  entity_id: z.string().uuid().optional().describe("If set, scopes to this entity's portfolio."),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
  group_by: z
    .enum(["investment", "investment_type", "entity", "year", "none"])
    .optional()
    .default("none")
    .describe(
      "Breakdown dimension. 'investment' buckets by deal (human-readable name), 'entity' buckets by the investor entity (human-readable name), 'investment_type' and 'year' are simple facets, 'none' returns a single total.",
    ),
});

export const getPortfolioSummaryTool = defineTool({
  name: "get_portfolio_summary",
  description:
    "Portfolio-wide capital activity. Group by investment_type, year, investment, entity, or return a single total. Use group_by to avoid calling per-investment or per-entity summary tools in a loop.",
  kind: "read",
  inputSchema: getPortfolioSummaryInput,
  handler: async (args, ctx) => {
    if (args.entity_id) await verifyEntityBelongsToOrg(ctx, args.entity_id);

    // Resolve relevant investment ids first (so we only sum over org-scoped rows).
    // Post-migration-032, scoping "deals an entity invests in" goes through the
    // investment_investors join, not a column on investments.
    let scopedInvIds: string[] | null = null;
    if (args.entity_id) {
      const { data: stakes, error: stakesErr } = await ctx.supabase
        .from("investment_investors")
        .select("investment_id")
        .eq("organization_id", ctx.orgId)
        .eq("entity_id", args.entity_id)
        .eq("is_active", true);
      if (stakesErr) throw stakesErr;
      scopedInvIds = (stakes ?? []).map((r: { investment_id: string }) => r.investment_id);
      if (scopedInvIds.length === 0) {
        return {
          data: {
            scope: { entity_id: args.entity_id },
            period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
            investment_count: 0,
            committed: 0,
            ...sumTxnsByType([]),
          },
        };
      }
    }

    let invQuery = ctx.supabase
      .from("investments")
      .select("id, name, investment_type, date_invested")
      .eq("organization_id", ctx.orgId);
    if (scopedInvIds) invQuery = invQuery.in("id", scopedInvIds);
    const { data: invRows, error: invErr } = await invQuery;
    if (invErr) throw invErr;
    const invIds = (invRows ?? []).map((r: { id: string }) => r.id);

    // Fetch the full investor-stake table scoped to these investments. We use
    // this for committed totals and for the investor_id → entity_id mapping
    // needed by group_by=entity. One query, two downstream uses.
    let stakes: Array<{
      id: string;
      entity_id: string;
      investment_id: string;
      committed_capital: number | string | null;
    }> = [];
    if (invIds.length > 0) {
      const { data: ii, error: iiErr } = await ctx.supabase
        .from("investment_investors")
        .select("id, entity_id, investment_id, committed_capital")
        .eq("organization_id", ctx.orgId)
        .eq("is_active", true)
        .in("investment_id", invIds);
      if (iiErr) throw iiErr;
      stakes = (ii ?? []) as typeof stakes;
    }
    const totalCommitted = stakes.reduce(
      (s: number, r) => s + (Number(r.committed_capital) || 0),
      0,
    );

    let txns: TxnRow[] = [];
    if (invIds.length > 0) {
      let txnQuery = ctx.supabase
        .from("investment_transactions")
        .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
        .eq("organization_id", ctx.orgId)
        .in("investment_id", invIds);
      if (args.date_from) txnQuery = txnQuery.gte("transaction_date", args.date_from);
      if (args.date_to) txnQuery = txnQuery.lte("transaction_date", args.date_to);
      const { data, error } = await txnQuery;
      if (error) throw error;
      txns = (data ?? []) as TxnRow[];
    }

    const totals = sumTxnsByType(txns);
    const base = {
      scope: args.entity_id ? { entity_id: args.entity_id } : { organization: true },
      period: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
      investment_count: invIds.length,
      committed: totalCommitted,
      ...totals,
    };

    if (args.group_by === "none") {
      return { data: base };
    }

    // Lookups for human-readable group labels + per-group committed totals.
    const invNameById = new Map<string, string>();
    const invTypeById = new Map<string, string>();
    for (const r of (invRows ?? []) as Array<{
      id: string;
      name: string;
      investment_type: string;
      date_invested: string | null;
    }>) {
      invNameById.set(r.id, r.name);
      invTypeById.set(r.id, r.investment_type);
    }

    // For group_by=entity we need entity_id → name too. Resolve with ONE
    // extra SELECT over the distinct entity ids in scope (no N+1).
    let entityNameById = new Map<string, string>();
    if (args.group_by === "entity") {
      const entityIds = Array.from(new Set(stakes.map((s) => s.entity_id)));
      if (entityIds.length > 0) {
        const { data: ents, error: entErr } = await ctx.supabase
          .from("entities")
          .select("id, name")
          .eq("organization_id", ctx.orgId)
          .in("id", entityIds);
        if (entErr) throw entErr;
        entityNameById = new Map(
          ((ents ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
        );
      }
    }

    // investor_stake_id → entity_id so txns can route to their owning entity.
    const investorEntityByStakeId = new Map<string, string>();
    for (const s of stakes) investorEntityByStakeId.set(s.id, s.entity_id);

    // Per-group committed totals (for investment / entity buckets).
    const committedByInvestment = new Map<string, number>();
    const committedByEntity = new Map<string, number>();
    for (const s of stakes) {
      const amt = Number(s.committed_capital) || 0;
      committedByInvestment.set(
        s.investment_id,
        (committedByInvestment.get(s.investment_id) ?? 0) + amt,
      );
      committedByEntity.set(
        s.entity_id,
        (committedByEntity.get(s.entity_id) ?? 0) + amt,
      );
    }

    type GroupKey = { id: string | null; label: string };
    const groupKeyForTxn = (t: TxnRow): GroupKey => {
      const invId = t.investment_id ?? "";
      switch (args.group_by) {
        case "investment":
          return { id: invId, label: invNameById.get(invId) ?? "unknown" };
        case "entity": {
          const entityId = investorEntityByStakeId.get(t.investment_investor_id ?? "") ?? null;
          return { id: entityId, label: entityId ? entityNameById.get(entityId) ?? "unknown" : "unknown" };
        }
        case "investment_type":
          return { id: invId, label: invTypeById.get(invId) ?? "unknown" };
        case "year":
          return { id: null, label: String(t.transaction_date?.slice(0, 4) ?? "unknown") };
        default:
          return { id: null, label: "all" };
      }
    };

    const groups = new Map<string, { id: string | null; rows: TxnRow[] }>();
    for (const t of txns) {
      const { id, label } = groupKeyForTxn(t);
      const entry = groups.get(label) ?? { id, rows: [] };
      entry.rows.push(t);
      groups.set(label, entry);
    }

    const by = Array.from(groups.entries()).map(([label, { id, rows }]) => {
      const bucket: Record<string, unknown> = { key: label, ...sumTxnsByType(rows) };
      if (args.group_by === "investment" && id) {
        bucket.investment_id = id;
        bucket.committed = committedByInvestment.get(id) ?? 0;
      } else if (args.group_by === "entity" && id) {
        bucket.entity_id = id;
        bucket.committed = committedByEntity.get(id) ?? 0;
      }
      return bucket;
    });

    return { data: { ...base, group_by: args.group_by, groups: by } };
  },
});

// --- get_cash_flow_summary ---------------------------------------------------

const getCashFlowSummaryInput = z.object({
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("investment"), id: z.string().uuid() }),
    z.object({ type: z.literal("investor"), id: z.string().uuid() }),
    z.object({ type: z.literal("entity"), id: z.string().uuid() }),
    z.object({ type: z.literal("portfolio") }),
  ]),
  period: z.enum(["month", "quarter", "year"]).optional().default("month"),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
});

function periodKey(isoDate: string, period: "month" | "quarter" | "year"): string {
  const y = isoDate.slice(0, 4);
  const m = parseInt(isoDate.slice(5, 7), 10);
  if (period === "year") return y;
  if (period === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  return isoDate.slice(0, 7); // YYYY-MM
}

export const getCashFlowSummaryTool = defineTool({
  name: "get_cash_flow_summary",
  description:
    "Contributions and distributions grouped by month, quarter, or year. scope selects the pool (one investment, one investor's stake, one internal entity's stakes, or org-wide portfolio).",
  kind: "read",
  inputSchema: getCashFlowSummaryInput,
  handler: async (args, ctx) => {
    // Resolve the set of investment_investor_ids the aggregation runs over.
    let stakeIds: string[] | null = null;
    let investmentFilter: string | null = null;

    if (args.scope.type === "investment") {
      await verifyInvestmentBelongsToOrg(ctx, args.scope.id);
      investmentFilter = args.scope.id;
    } else if (args.scope.type === "investor") {
      const { data, error } = await ctx.supabase
        .from("investment_investors")
        .select("id")
        .eq("id", args.scope.id)
        .eq("organization_id", ctx.orgId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolError("not_found", "investor stake not found");
      stakeIds = [args.scope.id];
    } else if (args.scope.type === "entity") {
      await verifyEntityBelongsToOrg(ctx, args.scope.id);
      const { data, error } = await ctx.supabase
        .from("investment_investors")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("entity_id", args.scope.id)
        .eq("is_active", true);
      if (error) throw error;
      stakeIds = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      // portfolio: any txn on an org-scoped investment.
      const { data, error } = await ctx.supabase
        .from("investments")
        .select("id")
        .eq("organization_id", ctx.orgId);
      if (error) throw error;
      const invIds = (data ?? []).map((r: { id: string }) => r.id);
      if (invIds.length === 0) {
        return {
          data: {
            scope: args.scope,
            period: args.period,
            range: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
            buckets: [],
          },
        };
      }
      // Use a composite filter — join-over-id below.
      let q = ctx.supabase
        .from("investment_transactions")
        .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
        .eq("organization_id", ctx.orgId)
        .in("investment_id", invIds);
      if (args.date_from) q = q.gte("transaction_date", args.date_from);
      if (args.date_to) q = q.lte("transaction_date", args.date_to);
      const txnRes = await q;
      if (txnRes.error) throw txnRes.error;
      return {
        data: buildCashFlowBuckets(
          args,
          (txnRes.data ?? []) as TxnRow[],
        ),
      };
    }

    let txnQuery = ctx.supabase
      .from("investment_transactions")
      .select("transaction_type, amount, transaction_date, investment_investor_id, investment_id")
      .eq("organization_id", ctx.orgId);
    if (investmentFilter) txnQuery = txnQuery.eq("investment_id", investmentFilter);
    if (stakeIds) {
      if (stakeIds.length === 0) {
        return {
          data: {
            scope: args.scope,
            period: args.period,
            range: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
            buckets: [],
          },
        };
      }
      txnQuery = txnQuery.in("investment_investor_id", stakeIds);
    }
    if (args.date_from) txnQuery = txnQuery.gte("transaction_date", args.date_from);
    if (args.date_to) txnQuery = txnQuery.lte("transaction_date", args.date_to);
    const { data, error } = await txnQuery;
    if (error) throw error;
    return { data: buildCashFlowBuckets(args, (data ?? []) as TxnRow[]) };
  },
});

function buildCashFlowBuckets(
  args: {
    scope: unknown;
    period?: "month" | "quarter" | "year";
    date_from?: string;
    date_to?: string;
  },
  txns: TxnRow[],
) {
  const period = args.period ?? "month";
  const buckets = new Map<string, TxnRow[]>();
  for (const t of txns) {
    if (!t.transaction_date) continue;
    const k = periodKey(t.transaction_date, period);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }
  const bucketRows = Array.from(buckets.entries())
    .map(([key, rows]) => ({ key, ...sumTxnsByType(rows) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    scope: args.scope,
    period,
    range: { date_from: args.date_from ?? null, date_to: args.date_to ?? null },
    buckets: bucketRows,
  };
}

// --- get_entity_summary (non-financial) --------------------------------------

const getEntitySummaryInput = z.object({ entity_id: z.string().uuid() });

export const getEntitySummaryTool = defineTool({
  name: "get_entity_summary",
  description:
    "Non-financial rollup for one entity: document count, upcoming compliance count, overdue compliance count, cap-table row count, relationship count. For 'what's happening with X' questions.",
  kind: "read",
  inputSchema: getEntitySummaryInput,
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);
    const today = todayIsoUtc();

    // documents + relationships carry organization_id → belt-and-suspenders.
    // compliance_obligations, cap_table_entries, entity_members, entity_managers
    // inherit org scope via the entity FK — parent-gate-only is enough here.
    const [docs, upcoming, overdue, capTable, relFrom, relTo, members, managers] =
      await Promise.all([
        ctx.supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .eq("entity_id", entity_id)
          .is("deleted_at", null),
        ctx.supabase
          .from("compliance_obligations")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity_id)
          .neq("status", "completed")
          .gte("next_due_date", today),
        ctx.supabase
          .from("compliance_obligations")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity_id)
          .neq("status", "completed")
          .lt("next_due_date", today),
        ctx.supabase
          .from("cap_table_entries")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity_id),
        ctx.supabase
          .from("relationships")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .eq("from_entity_id", entity_id),
        ctx.supabase
          .from("relationships")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.orgId)
          .eq("to_entity_id", entity_id),
        ctx.supabase
          .from("entity_members")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity_id),
        ctx.supabase
          .from("entity_managers")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity_id),
      ]);

    return {
      data: {
        entity_id,
        documents: docs.count ?? 0,
        compliance: {
          upcoming: upcoming.count ?? 0,
          overdue: overdue.count ?? 0,
        },
        cap_table: capTable.count ?? 0,
        relationships: (relFrom.count ?? 0) + (relTo.count ?? 0),
        members: members.count ?? 0,
        managers: managers.count ?? 0,
      },
    };
  },
});

// --- get_compliance_summary --------------------------------------------------

const getComplianceSummaryInput = z.object({
  entity_id: z.string().uuid().optional(),
  days_ahead: z.number().int().min(1).max(730).optional().default(90),
});

export const getComplianceSummaryTool = defineTool({
  name: "get_compliance_summary",
  description:
    "Obligations due within N days (default 90), grouped by entity and obligation_type. Optionally scoped to a single entity. Includes overdue rows (next_due_date < today).",
  kind: "read",
  inputSchema: getComplianceSummaryInput,
  handler: async (args, ctx) => {
    if (args.entity_id) await verifyEntityBelongsToOrg(ctx, args.entity_id);

    // Resolve entity ids in this org.
    let entQuery = ctx.supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", ctx.orgId);
    if (args.entity_id) entQuery = entQuery.eq("id", args.entity_id);
    const { data: ents, error: entErr } = await entQuery;
    if (entErr) throw entErr;
    const entIds = (ents ?? []).map((e: { id: string }) => e.id);
    if (entIds.length === 0) {
      return {
        data: {
          entity_id: args.entity_id ?? null,
          days_ahead: args.days_ahead ?? 90,
          obligations_upcoming: 0,
          obligations_overdue: 0,
          by_entity: [],
          by_type: [],
        },
      };
    }

    const todayIso = todayIsoUtc();
    const horizonIso = isoDateOffsetUtc(args.days_ahead ?? 90);

    const { data: oblig, error: oErr } = await ctx.supabase
      .from("compliance_obligations")
      .select("entity_id, obligation_type, next_due_date, status, name")
      .in("entity_id", entIds)
      .neq("status", "completed")
      .lte("next_due_date", horizonIso);
    if (oErr) throw oErr;

    const rows = (oblig ?? []) as Array<{
      entity_id: string;
      obligation_type: string;
      next_due_date: string;
      status: string;
      name: string;
    }>;

    const entNameById = new Map<string, string>(
      (ents ?? []).map((e: { id: string; name: string }) => [e.id, e.name]),
    );

    let upcoming = 0;
    let overdue = 0;
    const byEntity = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const r of rows) {
      if (r.next_due_date < todayIso) overdue++;
      else upcoming++;
      byEntity.set(r.entity_id, (byEntity.get(r.entity_id) ?? 0) + 1);
      byType.set(r.obligation_type, (byType.get(r.obligation_type) ?? 0) + 1);
    }

    return {
      data: {
        entity_id: args.entity_id ?? null,
        days_ahead: args.days_ahead ?? 90,
        obligations_upcoming: upcoming,
        obligations_overdue: overdue,
        by_entity: Array.from(byEntity.entries()).map(([id, count]) => ({
          entity_id: id,
          entity_name: entNameById.get(id) ?? null,
          count,
        })),
        by_type: Array.from(byType.entries()).map(([obligation_type, count]) => ({
          obligation_type,
          count,
        })),
      },
    };
  },
});

export const aggregationTools: ToolDefinition[] = [
  getInvestmentSummaryTool,
  getInvestmentInvestorSummaryTool,
  getEntityInvestmentSummaryTool,
  getPortfolioSummaryTool,
  getCashFlowSummaryTool,
  getEntitySummaryTool,
  getComplianceSummaryTool,
];
