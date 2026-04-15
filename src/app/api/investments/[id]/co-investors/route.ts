import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

/**
 * GET /api/investments/[id]/co-investors
 *
 * Returns co-investors for an investment with directory entry names.
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

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("investment_co_investors")
      .select("*, directory_entries!inner(name)")
      .eq("investment_id", id)
      .order("capital_pct", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("GET co-investors error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const coInvestors = (data || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const { directory_entries: _, ...rest } = row;
      return { ...rest, directory_entry_name: dirEntry?.name ?? null };
    });

    return NextResponse.json(coInvestors);
  } catch (err) {
    console.error("GET /api/investments/[id]/co-investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments/[id]/co-investors
 *
 * Replaces all co-investors for an investment.
 * Body: {
 *   co_investors: Array<{
 *     directory_entry_id: string,
 *     role?: string,
 *     capital_pct?: number,
 *     profit_pct?: number,
 *     notes?: string,
 *   }>
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
    const { co_investors } = body;

    if (!Array.isArray(co_investors)) {
      return NextResponse.json({ error: "co_investors array is required" }, { status: 400 });
    }

    // Delete existing co-investors
    await supabase
      .from("investment_co_investors")
      .delete()
      .eq("investment_id", id);

    // Insert new co-investors
    const results = [];
    for (const ci of co_investors) {
      if (!ci.directory_entry_id) continue;

      const { data, error } = await supabase
        .from("investment_co_investors")
        .insert({
          investment_id: id,
          organization_id: orgId,
          directory_entry_id: ci.directory_entry_id,
          role: ci.role || "co_investor",
          capital_pct: ci.capital_pct ?? null,
          profit_pct: ci.profit_pct ?? null,
          notes: ci.notes || null,
        })
        .select()
        .single();

      if (error) {
        console.error("Insert co-investor error:", error);
      } else {
        results.push(data);
      }
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_co_investor",
      resourceId: id,
      investmentId: id,
      metadata: {
        co_investor_count: results.length,
      },
      ...reqCtx,
    });

    return NextResponse.json(results, { status: 201 });
  } catch (err) {
    console.error("POST /api/investments/[id]/co-investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/investments/[id]/co-investors
 *
 * Deletes a single co-investor.
 * Body: { co_investor_id: string }
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
    const { co_investor_id } = body;

    if (!co_investor_id) {
      return NextResponse.json({ error: "co_investor_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("investment_co_investors")
      .delete()
      .eq("id", co_investor_id)
      .eq("investment_id", id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "investment_co_investor",
      resourceId: id,
      investmentId: id,
      metadata: { co_investor_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/investments/[id]/co-investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
