/**
 * GET /api/compliance — cross-entity compliance obligations for the org.
 *
 * Returns the same data shape as the MCP list_compliance_obligations tool,
 * exposed as a REST endpoint for the dedicated /compliance page. Supports
 * filter params: status, jurisdiction, entity_type, entity_id, entity_status,
 * due_within_days. Paginated.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const jurisdiction = url.searchParams.get("jurisdiction");
    const entityType = url.searchParams.get("entity_type");
    const entityId = url.searchParams.get("entity_id");
    const entityStatus = url.searchParams.get("entity_status") || "active";
    const dueWithinDays = parseInt(url.searchParams.get("due_within_days") || "0", 10);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = 100;

    const admin = createAdminClient();

    // Get entities for this org with optional filters.
    let entQuery = admin
      .from("entities")
      .select("id, name, type, status, formation_state")
      .eq("organization_id", orgId);
    if (entityStatus && entityStatus !== "all") {
      entQuery = entQuery.eq("status", entityStatus);
    }
    if (entityType && entityType !== "all") {
      entQuery = entQuery.eq("type", entityType);
    }
    if (entityId) {
      entQuery = entQuery.eq("id", entityId);
    }
    const { data: entities, error: entErr } = await entQuery.order("name");
    if (entErr) throw entErr;
    const entIds = (entities ?? []).map((e) => e.id);
    if (entIds.length === 0) {
      return NextResponse.json({ rows: [], summary: { overdue: 0, due_this_month: 0, upcoming: 0, completed_this_year: 0 }, page, pageSize, total: 0 });
    }

    const entMap = new Map(
      (entities ?? []).map((e: { id: string; name: string; type: string; status: string }) => [
        e.id,
        { name: e.name, type: e.type, status: e.status },
      ]),
    );

    // Build obligation query.
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${new Date().getFullYear()}-01-01`;

    let query = admin
      .from("compliance_obligations")
      .select("*", { count: "exact" })
      .in("entity_id", entIds)
      .order("next_due_date", { ascending: true });

    if (jurisdiction) query = query.eq("jurisdiction", jurisdiction);

    if (statusParam === "overdue") {
      query = query.eq("status", "pending").lt("next_due_date", today);
    } else if (statusParam === "due_soon") {
      const thirtyDays = new Date();
      thirtyDays.setDate(thirtyDays.getDate() + 30);
      query = query.eq("status", "pending").lte("next_due_date", thirtyDays.toISOString().slice(0, 10));
    } else if (statusParam === "pending") {
      query = query.eq("status", "pending");
    } else if (statusParam === "completed") {
      query = query.eq("status", "completed");
    } else if (statusParam === "exempt") {
      query = query.eq("status", "exempt");
    }
    // "all" → no status filter

    if (dueWithinDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + dueWithinDays);
      query = query.lte("next_due_date", cutoff.toISOString().slice(0, 10));
    }

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data: rows, error: oblErr, count } = await query;
    if (oblErr) throw oblErr;

    // Enrich with entity info.
    const enriched = (rows ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      entity_name: entMap.get(r.entity_id as string)?.name ?? null,
      entity_type: entMap.get(r.entity_id as string)?.type ?? null,
    }));

    // Summary counts (separate queries for accuracy with filters).
    const [overdueRes, dueMonthRes, upcomingRes, completedRes] = await Promise.all([
      admin
        .from("compliance_obligations")
        .select("id", { count: "exact", head: true })
        .in("entity_id", entIds)
        .eq("status", "pending")
        .lt("next_due_date", today),
      admin
        .from("compliance_obligations")
        .select("id", { count: "exact", head: true })
        .in("entity_id", entIds)
        .eq("status", "pending")
        .gte("next_due_date", today)
        .lte("next_due_date", (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })()),
      admin
        .from("compliance_obligations")
        .select("id", { count: "exact", head: true })
        .in("entity_id", entIds)
        .eq("status", "pending")
        .gte("next_due_date", today)
        .lte("next_due_date", (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); })()),
      admin
        .from("compliance_obligations")
        .select("id", { count: "exact", head: true })
        .in("entity_id", entIds)
        .eq("status", "completed")
        .gte("completed_at", yearStart),
    ]);

    return NextResponse.json({
      rows: enriched,
      summary: {
        overdue: overdueRes.count ?? 0,
        due_this_month: dueMonthRes.count ?? 0,
        upcoming: upcomingRes.count ?? 0,
        completed_this_year: completedRes.count ?? 0,
      },
      page,
      pageSize,
      total: count ?? 0,
    });
  } catch (err) {
    console.error("GET /api/compliance error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
