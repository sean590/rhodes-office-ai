import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { deriveTotalsFromTransactions, type TransactionTotalRow } from "@/lib/utils/transaction-totals";

/**
 * GET /api/entities/[id]/investments
 *
 * Returns investment summary for a parent entity (id = parent_entity_id).
 * Includes: deal list with allocation summaries, transaction totals,
 * and member totals across all deals.
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

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();

    // Fetch all active allocations where this entity is the parent
    const { data: allAllocations, error: allocErr } = await supabase
      .from("investment_allocations")
      .select("*, directory_entries!inner(name)")
      .eq("parent_entity_id", id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("allocation_pct", { ascending: false });

    if (allocErr) {
      console.error("Fetch allocations error:", allocErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Flatten directory names. Type as Record<string, unknown>[] so the
    // arbitrary columns from `select("*")` (member_directory_id, deal_entity_id,
    // committed_amount, etc.) remain accessible — the inferred return type
    // from the callback would otherwise collapse to just { member_name }.
    const allocations: Array<Record<string, unknown>> = (allAllocations || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const { directory_entries: _, ...rest } = row;
      return { ...rest, member_name: dirEntry?.name ?? null };
    });

    // Get unique deal entity IDs
    const dealEntityIds = [...new Set(allocations.map((a: Record<string, unknown>) => a.deal_entity_id as string))];

    if (dealEntityIds.length === 0) {
      return NextResponse.json({ deals: [], member_totals: [] });
    }

    // Fetch deal entity details
    const { data: dealEntities } = await supabase
      .from("entities")
      .select("id, name, short_name, type, status")
      .in("id", dealEntityIds);

    // Fetch cap table entries for deal entities (to get parent's ownership %)
    const { data: capTableEntries } = await supabase
      .from("cap_table_entries")
      .select("entity_id, investor_entity_id, ownership_pct")
      .in("entity_id", dealEntityIds)
      .eq("investor_entity_id", id);

    // Fetch all transactions for these deals
    const { data: allTransactions } = await supabase
      .from("investment_transactions")
      .select("*, directory_entries:member_directory_id(name), documents:document_id(name)")
      .eq("parent_entity_id", id)
      .eq("organization_id", orgId)
      .in("deal_entity_id", dealEntityIds)
      .order("transaction_date", { ascending: false });

    const transactions: Array<Record<string, unknown>> = (allTransactions || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const doc = row.documents as { name: string } | null;
      const { directory_entries: _, documents: _d, ...rest } = row;
      return { ...rest, member_name: dirEntry?.name ?? null, document_name: doc?.name ?? null };
    });

    // Fetch documents for each deal entity
    const { data: dealDocs } = await supabase
      .from("documents")
      .select("id, entity_id, name, document_type, document_category, year, file_path, created_at")
      .in("entity_id", dealEntityIds)
      .is("deleted_at", null)
      .order("document_category", { ascending: true })
      .order("created_at", { ascending: false });

    // Build per-deal summaries
    const deals = dealEntityIds.map((dealId) => {
      const entity = (dealEntities || []).find((e: { id: string }) => e.id === dealId);
      const dealAllocs = allocations.filter((a: Record<string, unknown>) => a.deal_entity_id === dealId);
      const dealTxns = transactions.filter((t: Record<string, unknown>) => t.deal_entity_id === dealId);
      // Parents are top-level transactions only (parent_transaction_id IS NULL).
      // This excludes both per-member splits AND distribution line items, so the
      // SUM below never double-counts gross/net or member shares.
      const parentTxns = dealTxns.filter((t: Record<string, unknown>) => t.parent_transaction_id === null);
      const memberTxns = dealTxns.filter((t: Record<string, unknown>) => t.member_directory_id !== null);
      const capEntry = (capTableEntries || []).find((c: { entity_id: string }) => c.entity_id === dealId);
      const docs = (dealDocs || []).filter((d: { entity_id: string | null }) => d.entity_id === dealId);

      // Spec 036: derive called/contributed/distributed totals from JSONB
      // line_items via the shared helper. The parent_transaction_id IS NULL
      // filter on parentTxns (above) is still required because member-split
      // children remain a separate row pattern.
      const totals = deriveTotalsFromTransactions(parentTxns as unknown as TransactionTotalRow[]);
      if (totals.contribution_fallback_count > 0) {
        console.warn(
          `[entities/investments] deal ${dealId}: ${totals.contribution_fallback_count} contribution row(s) fell back to "100% subscription".`
        );
      }

      // Committed capital for this deal = the parent entity's investment_investor
      // committed_capital, summed across that entity's investor row(s) for this deal.
      // We can derive it from the dealAllocs / cap entry but the cleanest source is
      // the investment_investors table itself — fetched below as part of the investor
      // row. For now, use the existing per-deal allocation sum where available.
      const committedForDeal = (dealAllocs as Array<Record<string, unknown>>).reduce(
        (s, a) => s + (a.committed_amount != null ? Number(a.committed_amount) : 0),
        0
      );
      const calledCapital = totals.called_capital;
      const uncalledCapital = committedForDeal > 0 ? Math.max(0, committedForDeal - calledCapital) : 0;

      return {
        deal_entity_id: dealId,
        entity_name: entity?.name || "Unknown",
        entity_short_name: entity?.short_name || null,
        entity_type: entity?.type || null,
        entity_status: entity?.status || null,
        ownership_pct: capEntry?.ownership_pct || null,
        participant_count: dealAllocs.length,
        allocations: dealAllocs,
        total_committed: committedForDeal,
        total_contributed: totals.total_contributed,
        total_distributed: totals.total_distributed_net,
        called_capital: calledCapital,
        uncalled_capital: uncalledCapital,
        total_distributed_gross: totals.total_distributed_gross,
        total_distributed_net: totals.total_distributed_net,
        recent_transactions: parentTxns.slice(0, 5),
        child_transactions: memberTxns,
        documents: docs,
      };
    });

    // Build member totals across all deals
    const memberMap = new Map<string, {
      member_directory_id: string;
      member_name: string;
      deal_count: number;
      total_contributed: number;
      total_distributed: number;
    }>();

    for (const alloc of allocations) {
      const mid = alloc.member_directory_id as string;
      if (!memberMap.has(mid)) {
        memberMap.set(mid, {
          member_directory_id: mid,
          member_name: (alloc as Record<string, unknown>).member_name as string || "Unknown",
          deal_count: 0,
          total_contributed: 0,
          total_distributed: 0,
        });
      }
    }

    // Count deals per member (from allocations)
    const memberDeals = new Map<string, Set<string>>();
    for (const alloc of allocations) {
      const mid = alloc.member_directory_id as string;
      const did = alloc.deal_entity_id as string;
      if (!memberDeals.has(mid)) memberDeals.set(mid, new Set());
      memberDeals.get(mid)!.add(did);
    }
    for (const [mid, deals] of memberDeals) {
      const entry = memberMap.get(mid);
      if (entry) entry.deal_count = deals.size;
    }

    // Sum transactions per member
    for (const txn of transactions) {
      const mid = txn.member_directory_id as string | null;
      if (!mid) continue;
      const entry = memberMap.get(mid);
      if (!entry) continue;
      if (txn.transaction_type === "contribution") {
        entry.total_contributed += Number(txn.amount);
      } else {
        entry.total_distributed += Number(txn.amount);
      }
    }

    const memberTotals = Array.from(memberMap.values()).sort((a, b) => b.total_contributed - a.total_contributed);

    return NextResponse.json({ deals, member_totals: memberTotals });
  } catch (err) {
    console.error("GET /api/entities/[id]/investments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
