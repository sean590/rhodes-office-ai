import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

/**
 * GET /api/investments/[id]/investors
 *
 * Returns active investors (internal entities) for an investment.
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
      .from("investment_investors")
      .select("*, entities:entity_id(name, short_name)")
      .eq("investment_id", id)
      .eq("is_active", true);

    if (error) {
      console.error("GET investment investors error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const investors = (data || []).map((row: Record<string, unknown>) => {
      const entity = row.entities as { name: string; short_name: string | null } | null;
      const { entities: _, ...rest } = row;
      return {
        ...rest,
        entity_name: entity?.name ?? null,
        entity_short_name: entity?.short_name ?? null,
      };
    });

    return NextResponse.json(investors);
  } catch (err) {
    console.error("GET /api/investments/[id]/investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments/[id]/investors
 *
 * Replaces all investors for an investment.
 * Body: {
 *   investors: Array<{ entity_id: string, committed_capital?: number | null, capital_pct?: number, profit_pct?: number }>
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
    const { investors } = body;

    if (!Array.isArray(investors)) {
      return NextResponse.json({ error: "investors array is required" }, { status: 400 });
    }

    // Validate payload up front before any writes.
    for (const inv of investors) {
      if (!inv.entity_id) {
        return NextResponse.json({ error: "Each investor must have an entity_id" }, { status: 400 });
      }
    }

    // Upsert semantics. The table has UNIQUE(investment_id, entity_id) across
    // ALL rows (active + inactive), so the old "deactivate then insert" pattern
    // collided whenever an entity was already in the table — even as an
    // inactive row from a previous edit. Strategy now:
    //   1. Fetch all existing rows (active + inactive) for this investment.
    //   2. For each entity_id in the new payload: if a row exists, UPDATE it
    //      back to active with the new fields; otherwise INSERT a fresh row.
    //   3. Any active row whose entity_id is NOT in the new payload gets
    //      deactivated.
    // Allocations and transactions hang off investment_investor.id, so
    // reusing existing rows preserves those references — strictly better than
    // delete + re-insert which would orphan downstream data.
    const { data: existingRows, error: existingErr } = await supabase
      .from("investment_investors")
      .select("id, entity_id, is_active")
      .eq("investment_id", id);

    if (existingErr) {
      console.error("Fetch existing investors error:", existingErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const existingByEntity = new Map<string, { id: string; is_active: boolean }>();
    for (const row of existingRows || []) {
      existingByEntity.set(row.entity_id, { id: row.id, is_active: row.is_active });
    }

    const payloadEntityIds = new Set<string>(investors.map((inv: { entity_id: string }) => inv.entity_id));
    const results: unknown[] = [];

    for (const inv of investors) {
      const existing = existingByEntity.get(inv.entity_id);
      const fields = {
        committed_capital: inv.committed_capital ?? null,
        capital_pct: inv.capital_pct ?? null,
        profit_pct: inv.profit_pct ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        // Reactivate / update existing row.
        const { data, error } = await supabase
          .from("investment_investors")
          .update(fields)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) {
          console.error("Update investor error:", error);
          return NextResponse.json({ error: "Failed to update investor row" }, { status: 500 });
        }
        results.push(data);
      } else {
        const { data, error } = await supabase
          .from("investment_investors")
          .insert({
            investment_id: id,
            organization_id: orgId,
            entity_id: inv.entity_id,
            ...fields,
            created_by: user.id,
          })
          .select()
          .single();
        if (error) {
          console.error("Insert investor error:", error);
          return NextResponse.json({ error: "Failed to insert investor row" }, { status: 500 });
        }
        results.push(data);
      }
    }

    // Deactivate any existing active rows that were dropped from the payload.
    const droppedIds = (existingRows || [])
      .filter(r => r.is_active && !payloadEntityIds.has(r.entity_id))
      .map(r => r.id);
    if (droppedIds.length > 0) {
      const { error: deactErr } = await supabase
        .from("investment_investors")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", droppedIds);
      if (deactErr) {
        console.error("Deactivate dropped investors error:", deactErr);
        return NextResponse.json({ error: "Failed to deactivate dropped investors" }, { status: 500 });
      }
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_investor",
      resourceId: id,
      investmentId: id,
      metadata: {
        investor_count: investors.length,
        entity_ids: investors.map((inv: { entity_id: string }) => inv.entity_id),
      },
      ...reqCtx,
    });

    return NextResponse.json(results, { status: 201 });
  } catch (err) {
    console.error("POST /api/investments/[id]/investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/investments/[id]/investors
 *
 * Updates a single investor row (entity_id, capital_pct, profit_pct).
 * Body: { investor_id: string, entity_id?: string, capital_pct?: number | null, profit_pct?: number | null }
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

    const supabase = createAdminClient();
    const body = await request.json();
    const { investor_id, entity_id, capital_pct, profit_pct, committed_capital } = body;

    if (!investor_id) {
      return NextResponse.json({ error: "investor_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (entity_id !== undefined) updates.entity_id = entity_id;
    if (capital_pct !== undefined) updates.capital_pct = capital_pct;
    if (profit_pct !== undefined) updates.profit_pct = profit_pct;
    if (committed_capital !== undefined) updates.committed_capital = committed_capital;

    const { data, error } = await supabase
      .from("investment_investors")
      .update(updates)
      .eq("id", investor_id)
      .eq("investment_id", id)
      .select("*, entities:entity_id(name, short_name)")
      .single();

    if (error) {
      console.error("PATCH investor error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "investment_investor",
      resourceId: investor_id,
      investmentId: id,
      metadata: { investor_id, ...updates },
      ...reqCtx,
    });

    const entity = data.entities as { name: string; short_name: string | null } | null;
    const { entities: _, ...rest } = data;
    return NextResponse.json({ ...rest, entity_name: entity?.name ?? null, entity_short_name: entity?.short_name ?? null });
  } catch (err) {
    console.error("PATCH /api/investments/[id]/investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/investments/[id]/investors
 *
 * Deactivates a single investor.
 * Body: { investor_id: string }
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
    const { investor_id } = body;

    if (!investor_id) {
      return NextResponse.json({ error: "investor_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("investment_investors")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", investor_id)
      .eq("investment_id", id);

    if (error) {
      console.error("DELETE investor error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "investment_investor",
      resourceId: id,
      investmentId: id,
      metadata: { investor_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/investments/[id]/investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
