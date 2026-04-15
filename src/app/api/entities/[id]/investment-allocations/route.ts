import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

/**
 * GET /api/entities/[id]/investment-allocations
 *
 * Returns investment allocations for a deal entity (id = deal_entity_id).
 * Query params:
 *   - parent_entity_id (optional): filter by parent entity
 *   - include_inactive (optional): include deactivated allocations
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
    const url = new URL(request.url);
    const parentEntityId = url.searchParams.get("parent_entity_id");
    const includeInactive = url.searchParams.get("include_inactive") === "true";

    let query = supabase
      .from("investment_allocations")
      .select("*, directory_entries!inner(name)")
      .eq("deal_entity_id", id)
      .eq("organization_id", orgId)
      .order("allocation_pct", { ascending: false });

    if (parentEntityId) {
      query = query.eq("parent_entity_id", parentEntityId);
    }

    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET investment-allocations error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Flatten joined directory name
    const allocations = (data || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const { directory_entries: _, ...rest } = row;
      return {
        ...rest,
        member_name: dirEntry?.name ?? null,
      };
    });

    return NextResponse.json(allocations);
  } catch (err) {
    console.error("GET /api/entities/[id]/investment-allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/entities/[id]/investment-allocations
 *
 * Creates or updates allocations for a deal entity.
 * Body: {
 *   parent_entity_id: string,
 *   allocations: Array<{
 *     member_directory_id: string,
 *     allocation_pct: number,
 *     committed_amount?: number | null,
 *     notes?: string | null,
 *   }>,
 *   effective_date?: string | null,
 * }
 *
 * Accepts the full set of allocations at once (replaces active set).
 * Members not in the new set are deactivated. Members already present are updated.
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

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();

    const { parent_entity_id, allocations, effective_date } = body;

    if (!parent_entity_id) {
      return NextResponse.json({ error: "parent_entity_id is required" }, { status: 400 });
    }
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json({ error: "allocations array is required" }, { status: 400 });
    }

    // Validate parent entity belongs to org
    const parentValid = await validateEntityOrg(parent_entity_id, orgId);
    if (!parentValid) {
      return NextResponse.json({ error: "Parent entity not found" }, { status: 404 });
    }

    // Validate percentages sum to 100
    const totalPct = allocations.reduce(
      (sum: number, a: { allocation_pct: number }) => sum + Number(a.allocation_pct),
      0
    );
    if (Math.abs(totalPct - 100) > 0.01) {
      return NextResponse.json(
        { error: `Allocations must sum to 100% (got ${totalPct.toFixed(4)}%)` },
        { status: 400 }
      );
    }

    // Fetch existing active allocations for this deal+parent
    const { data: existing } = await supabase
      .from("investment_allocations")
      .select("id, member_directory_id")
      .eq("deal_entity_id", id)
      .eq("parent_entity_id", parent_entity_id)
      .eq("is_active", true);

    const existingMap = new Map(
      (existing || []).map((e: { id: string; member_directory_id: string }) => [e.member_directory_id, e.id])
    );

    const incomingMemberIds = new Set(
      allocations.map((a: { member_directory_id: string }) => a.member_directory_id)
    );

    // Deactivate members no longer in the set
    const toDeactivate = (existing || [])
      .filter((e: { member_directory_id: string }) => !incomingMemberIds.has(e.member_directory_id))
      .map((e: { id: string }) => e.id);

    if (toDeactivate.length > 0) {
      await supabase
        .from("investment_allocations")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", toDeactivate);
    }

    // Upsert each allocation
    const results = [];
    for (const alloc of allocations) {
      const existingId = existingMap.get(alloc.member_directory_id);

      if (existingId) {
        // Update existing
        const { data, error } = await supabase
          .from("investment_allocations")
          .update({
            allocation_pct: alloc.allocation_pct,
            committed_amount: alloc.committed_amount ?? null,
            notes: alloc.notes ?? null,
            effective_date: effective_date || null,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingId)
          .select()
          .single();

        if (error) {
          console.error("Update allocation error:", error);
          return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }
        results.push(data);
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("investment_allocations")
          .insert({
            organization_id: orgId,
            parent_entity_id,
            deal_entity_id: id,
            member_directory_id: alloc.member_directory_id,
            allocation_pct: alloc.allocation_pct,
            committed_amount: alloc.committed_amount ?? null,
            effective_date: effective_date || null,
            notes: alloc.notes ?? null,
            created_by: user.id,
          })
          .select()
          .single();

        if (error) {
          console.error("Insert allocation error:", error);
          return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }
        results.push(data);
      }
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_allocation",
      resourceId: id,
      entityId: id,
      metadata: {
        parent_entity_id,
        member_count: allocations.length,
        deactivated_count: toDeactivate.length,
      },
      ...reqCtx,
    });

    return NextResponse.json(results, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/investment-allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/entities/[id]/investment-allocations
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

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();
    const { allocation_id } = body;

    if (!allocation_id) {
      return NextResponse.json({ error: "allocation_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("investment_allocations")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", allocation_id)
      .eq("deal_entity_id", id);

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
      entityId: id,
      metadata: { allocation_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/investment-allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
