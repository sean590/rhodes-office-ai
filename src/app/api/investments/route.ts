import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { createInvestmentSchema } from "@/lib/validations";
import { deriveTotalsFromTransactions, type TransactionTotalRow } from "@/lib/utils/transaction-totals";

/**
 * GET /api/investments
 *
 * Lists all investments for the user's organization.
 * Query params:
 *   - entity_id (optional): filter to investments where this entity is an investor
 *   - status (optional): filter by status
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = createAdminClient();
    const url = new URL(request.url);
    const entityId = url.searchParams.get("entity_id");
    const status = url.searchParams.get("status");

    // If filtering by entity_id, first get matching investment IDs from
    // investment_investors. If the entity is a person, also include any
    // investments held under a joint_title entity the person is a member of
    // (spec §5 "Surfacing rules on the Investments tab").
    let investmentIdFilter: string[] | null = null;
    let jointTitleIdsForPerson: string[] = [];
    if (entityId) {
      // Detect whether this is a person; if so, expand the filter to cover
      // their joint_title memberships as well.
      const { data: entityRow } = await supabase
        .from("entities")
        .select("type")
        .eq("id", entityId)
        .eq("organization_id", orgId)
        .maybeSingle();

      const entityIdsToQuery: string[] = [entityId];
      if (entityRow?.type === "person") {
        const { data: memberships } = await supabase
          .from("joint_title_members")
          .select("joint_title_id")
          .eq("person_entity_id", entityId);
        jointTitleIdsForPerson = (memberships || []).map(m => m.joint_title_id);
        entityIdsToQuery.push(...jointTitleIdsForPerson);
      }

      const { data: investorRows, error: investorErr } = await supabase
        .from("investment_investors")
        .select("investment_id")
        .in("entity_id", entityIdsToQuery)
        .eq("is_active", true);

      if (investorErr) {
        console.error("GET investments investor filter error:", investorErr);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }

      investmentIdFilter = Array.from(new Set((investorRows || []).map(
        (r: Record<string, unknown>) => r.investment_id as string
      )));

      // No matching investments — return early
      if (investmentIdFilter.length === 0) {
        return NextResponse.json([]);
      }
    }

    let query = supabase
      .from("investments")
      .select("*")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    if (investmentIdFilter) {
      query = query.in("id", investmentIdFilter);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET investments error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Enrich each investment with investors, participant count, and transaction totals
    const investments = await Promise.all(
      (data || []).map(async (row: Record<string, unknown>) => {
        const investmentId = row.id as string;

        // Get investors with entity names
        const { data: investors } = await supabase
          .from("investment_investors")
          .select("id, entity_id, capital_pct, profit_pct, is_active, entities(name)")
          .eq("investment_id", investmentId)
          .eq("is_active", true);

        const investorCount = (investors || []).length;
        const investorNames = (investors || []).map(
          (inv: Record<string, unknown>) => {
            const entity = inv.entities as { name: string } | null;
            return entity?.name ?? null;
          }
        ).filter(Boolean);

        // Get investor IDs for sub-queries.
        // When the caller filtered by entity_id, scope totals/participant counts
        // to that entity's investor row(s) only — so the per-entity tab shows
        // capital that THIS entity actually contributed, not the deal-wide total.
        const scopeIds = entityId ? new Set([entityId, ...jointTitleIdsForPerson]) : null;
        const scopedInvestors = scopeIds
          ? (investors || []).filter(
              (inv: Record<string, unknown>) => scopeIds.has(inv.entity_id as string)
            )
          : (investors || []);
        const investorIds = scopedInvestors.map((inv: Record<string, unknown>) => inv.id as string);

        // Get participant count from allocations (via investor IDs)
        let participantCount = 0;
        if (investorIds.length > 0) {
          const { count } = await supabase
            .from("investment_allocations")
            .select("id", { count: "exact", head: true })
            .in("investment_investor_id", investorIds)
            .eq("is_active", true);
          participantCount = count || 0;
        }

        // Get transaction totals (parent-level only, via investor IDs).
        // The `parent_transaction_id IS NULL` filter excludes member-split
        // child rows; line items live in JSONB on the parent now (spec 036).
        let txns: TransactionTotalRow[] = [];
        if (investorIds.length > 0) {
          const { data } = await supabase
            .from("investment_transactions")
            .select("transaction_type, amount, line_items, adjusts_transaction_id")
            .in("investment_investor_id", investorIds)
            .is("parent_transaction_id", null);
          txns = (data || []) as TransactionTotalRow[];
        }

        const totals = deriveTotalsFromTransactions(txns);

        // Compute committed/uncalled across the scoped investors. Sum each
        // investor's `committed_capital`; uncalled = max(0, committed - called).
        const totalCommitted = scopedInvestors.reduce(
          (s: number, inv: Record<string, unknown>) =>
            s + (inv.committed_capital != null ? Number(inv.committed_capital) : 0),
          0
        );
        const calledCapital = totals.called_capital;
        const uncalledCapital = Math.max(0, totalCommitted - calledCapital);

        if (totals.contribution_fallback_count > 0) {
          console.warn(
            `[investments] investment ${investmentId}: ${totals.contribution_fallback_count} contribution row(s) fell back to "100% subscription" — empty line_items. Consider adding line items via the UI.`
          );
        }

        return {
          ...row,
          investor_count: investorCount,
          investor_names: investorNames,
          participant_count: participantCount || 0,
          total_committed: totalCommitted,
          total_contributed: totals.total_contributed,
          total_distributed: totals.total_distributed_net, // back-compat alias
          called_capital: calledCapital,
          uncalled_capital: uncalledCapital,
          total_distributed_gross: totals.total_distributed_gross,
          total_distributed_net: totals.total_distributed_net,
        };
      })
    );

    return NextResponse.json(investments);
  } catch (err) {
    console.error("GET /api/investments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments
 *
 * Creates a new investment with investors and optional co-investors.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json();
    const parsed = createInvestmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Validation error" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const supabase = createAdminClient();

    // Create the investment row (no parent_entity_id, capital_pct, or profit_pct)
    const { data: investment, error } = await supabase
      .from("investments")
      .insert({
        organization_id: orgId,
        name: data.name,
        short_name: data.short_name || null,
        investment_type: data.investment_type,
        status: data.status,
        entity_id: data.entity_id || null,
        description: data.description || null,
        formation_state: data.formation_state || null,
        date_invested: data.date_invested || null,
        date_exited: data.date_exited || null,
        preferred_return_pct: data.preferred_return_pct ?? null,
        preferred_return_basis: data.preferred_return_basis || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("POST investments error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Create investment_investors rows
    const investorRows = data.investors.map((inv) => ({
      organization_id: orgId,
      investment_id: investment.id,
      entity_id: inv.entity_id,
      capital_pct: inv.capital_pct ?? null,
      profit_pct: inv.profit_pct ?? null,
      committed_capital: inv.committed_capital ?? null,
      is_active: true,
      created_by: user.id,
    }));

    const { data: createdInvestors, error: investorError } = await supabase
      .from("investment_investors")
      .insert(investorRows)
      .select("id, entity_id");

    if (investorError) {
      console.error("POST investment_investors error:", investorError);
      // Clean up the investment row on failure
      await supabase.from("investments").delete().eq("id", investment.id);
      return NextResponse.json({ error: "Failed to create investors" }, { status: 500 });
    }

    // Create investment_co_investors rows if any
    if (data.co_investors && data.co_investors.length > 0) {
      const coInvestorRows = data.co_investors.map((ci) => ({
        investment_id: investment.id,
        directory_entry_id: ci.directory_entry_id,
        role: ci.role,
        capital_pct: ci.capital_pct ?? null,
        profit_pct: ci.profit_pct ?? null,
        notes: ci.notes || null,
        created_by: user.id,
      }));

      const { error: coInvestorError } = await supabase
        .from("investment_co_investors")
        .insert(coInvestorRows);

      if (coInvestorError) {
        console.error("POST investment_co_investors error:", coInvestorError);
        // Non-fatal: investment and investors were created successfully
      }
    }

    // Audit log
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment",
      resourceId: investment.id,
      investmentId: investment.id,
      metadata: {
        description: `Created investment: ${data.name} (${data.investment_type})`,
        name: data.name,
        investment_type: data.investment_type,
        investor_count: data.investors.length,
        co_investor_count: data.co_investors?.length || 0,
      },
      ...reqCtx,
    });

    return NextResponse.json(
      {
        ...investment,
        investors: createdInvestors || [],
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/investments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
