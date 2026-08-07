import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import { requireSensitive } from "@/lib/utils/aal";
import { logAuditEvent, getRequestContext, humanizeField, buildChanges } from "@/lib/utils/audit";
import { updateInvestmentSchema } from "@/lib/validations";
import {
  deriveTotalsFromTransactions,
  deriveCalledCapitalByKey,
  earliestContributionDate,
  type TransactionTotalRow,
} from "@/lib/utils/transaction-totals";
import { resolveParticipants } from "@/lib/investment-participants";

/**
 * GET /api/investments/[id]
 *
 * Returns a single investment with investors, co-investors, and summary stats.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const supabase = createOrgClient(orgId);

    // Fetch investment
    const { data: investment, error } = await supabase
      .from("investments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !investment) {
      return NextResponse.json({ error: "Investment not found" }, { status: 404 });
    }

    // Participants: cap-table members (tied) or investment_investors (standalone).
    // The resolver returns a uniform shape + the transaction grouping key so
    // metrics compute the same way regardless of source.
    const { participants: investors, txnKey, tied } = await resolveParticipants(supabase, investment);
    const investorIds = investors.map((inv) => inv.id);

    // Fetch co-investors with directory names
    const { data: coInvestorsRaw } = await supabase
      .from("investment_co_investors")
      .select("*, directory_entries!inner(name)")
      .eq("investment_id", id);

    const coInvestors = (coInvestorsRaw || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const { directory_entries: _, ...rest } = row;
      return { ...rest, directory_entry_name: dirEntry?.name ?? null };
    });

    // Participant count: tied → the cap-table members; standalone → allocations.
    let participantCount = 0;
    if (tied) {
      participantCount = investors.length;
    } else if (investorIds.length > 0) {
      const { count } = await supabase
        .from("investment_allocations")
        .select("id", { count: "exact", head: true })
        .in("investment_investor_id", investorIds)
        .eq("is_active", true);
      participantCount = count || 0;
    }

    // Per-participant called capital + roll-up totals from parent-level
    // transactions (member-split children excluded by parent_transaction_id IS NULL).
    // Fetched by investment_id (works for both keys); grouped by the resolver's
    // txnKey — cap_table_entry_id (tied) or investment_investor_id (standalone).
    const { data: txnData } = await supabase
      .from("investment_transactions")
      .select("investment_investor_id, cap_table_entry_id, transaction_type, amount, line_items, adjusts_transaction_id, transaction_date")
      .eq("investment_id", id)
      .is("parent_transaction_id", null);
    const txns = (txnData || []) as Array<TransactionTotalRow & { investment_investor_id: string | null; cap_table_entry_id: string | null }>;

    const totals = deriveTotalsFromTransactions(txns);
    const calledByParticipant = deriveCalledCapitalByKey(txns, txnKey);

    if (totals.contribution_fallback_count > 0) {
      console.warn(
        `[investments] investment ${id}: ${totals.contribution_fallback_count} contribution row(s) fell back to "100% subscription" — empty line_items.`
      );
    }

    // Enrich participants with called/uncalled capital
    const enrichedInvestors = investors.map((inv) => {
      const committed = inv.committed_capital != null ? Number(inv.committed_capital) : null;
      const called = calledByParticipant[inv.id] || 0;
      return {
        ...inv,
        called_capital: called,
        uncalled_capital: committed != null ? Math.max(0, committed - called) : null,
      };
    });

    const totalCommitted = enrichedInvestors.reduce((s: number, i) =>
      s + (i.committed_capital != null ? Number(i.committed_capital) : 0), 0);

    return NextResponse.json({
      ...investment,
      // Fall back to the earliest contribution date when no explicit
      // date_invested is set (keeps list + detail consistent).
      date_invested: investment.date_invested ?? earliestContributionDate(txns),
      investors: enrichedInvestors,
      co_investors: coInvestors,
      participant_count: participantCount,
      total_committed: totalCommitted,
      total_contributed: totals.total_contributed,
      total_distributed: totals.total_distributed_net, // back-compat alias
      called_capital: totals.called_capital,
      uncalled_capital: Math.max(0, totalCommitted - totals.called_capital),
      total_distributed_gross: totals.total_distributed_gross,
      total_distributed_net: totals.total_distributed_net,
    });
  } catch (err) {
    console.error("GET /api/investments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/investments/[id]
 *
 * Updates deal metadata only (name, status, pref return, description, etc.).
 * Investor updates go through /api/investments/[id]/investors.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const body = await request.json();
    const parsed = updateInvestmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Validation error" },
        { status: 400 }
      );
    }

    const updates = parsed.data;
    const supabase = createOrgClient(orgId);

    // Fetch existing record before update for change tracking
    const { data: existing } = await supabase
      .from("investments")
      .select("*")
      .eq("id", id)
      .single();

    // Tie-to-cap-table requires a linked managed entity (that's the owner list).
    if (updates.cap_table_tied === true) {
      const entityId = updates.entity_id ?? (existing as { entity_id?: string } | null)?.entity_id;
      if (!entityId) {
        return NextResponse.json(
          { error: "Link this investment to a managed entity before tying it to the cap table." },
          { status: 400 },
        );
      }
    }

    const { data: investment, error } = await supabase
      .from("investments")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("PATCH investment error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const changedFields = Object.keys(updates).map((f) => humanizeField(f)).join(", ");
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "investment",
      resourceId: id,
      investmentId: id,
      metadata: {
        description: `Updated investment ${existing?.name ?? id}: ${changedFields}`,
        changes: existing ? buildChanges(existing as Record<string, unknown>, updates as Record<string, unknown>) : [],
        investment_name: existing?.name ?? null,
        fields_updated: Object.keys(updates),
      },
      ...reqCtx,
    });

    return NextResponse.json(investment);
  } catch (err) {
    console.error("PATCH /api/investments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/investments/[id]
 *
 * Hard deletes an investment. CASCADE handles investors, allocations,
 * transactions, and co-investors.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSensitive("records:delete");
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const supabase = createOrgClient(orgId);

    // Get name for audit log before deleting
    const { data: existing } = await supabase
      .from("investments")
      .select("name")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("investments")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("DELETE investment error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "investment",
      resourceId: id,
      investmentId: id,
      metadata: {
        description: `Deleted investment: ${existing?.name ?? id}`,
        investment_name: existing?.name ?? null,
      },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/investments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
