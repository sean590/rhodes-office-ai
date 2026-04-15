import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

/**
 * GET /api/investments/[id]/allocations?investor_id=<uuid>
 *
 * Returns active allocations for a specific investor on an investment.
 * Query param `investor_id` (investment_investor_id) is required.
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

    const url = new URL(request.url);
    const investorId = url.searchParams.get("investor_id");

    if (!investorId) {
      return NextResponse.json({ error: "investor_id query param is required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("investment_allocations")
      .select("*, directory_entries:member_directory_id(name), member_entity:entities!investment_allocations_member_entity_id_fkey(name)")
      .eq("investment_investor_id", investorId)
      .eq("is_active", true)
      .order("allocation_pct", { ascending: false });

    if (error) {
      console.error("GET investment allocations error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const allocations = (data || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const entityEntry = row.member_entity as { name: string } | null;
      const { directory_entries: _, member_entity: _e, ...rest } = row;
      return { ...rest, member_name: dirEntry?.name ?? entityEntry?.name ?? null };
    });

    return NextResponse.json(allocations);
  } catch (err) {
    console.error("GET /api/investments/[id]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments/[id]/allocations
 *
 * Sets allocations for a specific investor on an investment. Replaces the active set.
 * Body: {
 *   investor_id: string (investment_investor_id),
 *   allocations: Array<{
 *     member_directory_id?: string,
 *     member_entity_id?: string,
 *     allocation_pct: number,
 *     committed_amount?: number,
 *     notes?: string,
 *   }>,
 *   effective_date?: string,
 * }
 */
export async function POST(
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

    const supabase = createAdminClient();
    const body = await request.json();
    const { investor_id, allocations, effective_date } = body;

    if (!investor_id) {
      return NextResponse.json({ error: "investor_id is required" }, { status: 400 });
    }

    if (!Array.isArray(allocations)) {
      return NextResponse.json({ error: "allocations array is required" }, { status: 400 });
    }

    // Validate percentages sum to 100 (only if there are allocations)
    if (allocations.length > 0) {
      const totalPct = allocations.reduce(
        (sum: number, a: { allocation_pct: number }) => sum + Number(a.allocation_pct),
        0
      );
      if (Math.abs(totalPct - 100) > 0.02) {
        return NextResponse.json(
          { error: `Allocations must sum to 100% (got ${totalPct.toFixed(4)}%)` },
          { status: 400 }
        );
      }
    }

    // Deactivate ALL existing active allocations for this investor
    await supabase
      .from("investment_allocations")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("investment_investor_id", investor_id)
      .eq("is_active", true);

    // Insert fresh allocations
    const results = [];
    for (const alloc of allocations) {
      const insertData: Record<string, unknown> = {
        organization_id: orgId,
        investment_investor_id: investor_id,
        allocation_pct: alloc.allocation_pct,
        committed_amount: alloc.committed_amount ?? null,
        effective_date: effective_date || null,
        notes: alloc.notes ?? null,
        is_active: true,
        created_by: user.id,
      };
      if (alloc.member_entity_id) {
        insertData.member_entity_id = alloc.member_entity_id;
      }
      if (alloc.member_directory_id) {
        insertData.member_directory_id = alloc.member_directory_id;
      }

      const { data, error } = await supabase
        .from("investment_allocations")
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error("Insert allocation error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      results.push(data);
    }

    // Fetch investment name for audit description
    const { data: investmentRecord } = await supabase
      .from("investments")
      .select("name")
      .eq("id", id)
      .single();
    const investmentName = investmentRecord?.name ?? id;

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_allocation",
      resourceId: id,
      investmentId: id,
      metadata: {
        description: `Updated allocations for ${investmentName} (${allocations.length} members)`,
        investment_name: investmentName,
        investor_id,
        member_count: allocations.length,
      },
      ...reqCtx,
    });

    return NextResponse.json(results, { status: 201 });
  } catch (err) {
    console.error("POST /api/investments/[id]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/investments/[id]/allocations
 *
 * Soft-deletes (deactivates) a single allocation.
 * Body: { allocation_id: string }
 */
export async function DELETE(
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

    const supabase = createAdminClient();
    const body = await request.json();
    const { allocation_id } = body;

    if (!allocation_id) {
      return NextResponse.json({ error: "allocation_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("investment_allocations")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", allocation_id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "investment_allocation",
      resourceId: id,
      investmentId: id,
      metadata: { allocation_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/investments/[id]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
