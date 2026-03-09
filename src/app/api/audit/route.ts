import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { user, orgId } = ctx;

    if (user.orgRole !== "admin" && user.orgRole !== "owner") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const admin = createAdminClient();

    const url = new URL(request.url);
    const resourceType = url.searchParams.get("resource_type");
    const resourceId = url.searchParams.get("resource_id");
    const entityId = url.searchParams.get("entity_id");
    const userId = url.searchParams.get("user_id");
    const action = url.searchParams.get("action");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    let query = admin
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 200));

    if (resourceType) query = query.eq("resource_type", resourceType);
    if (resourceId) query = query.eq("resource_id", resourceId);
    if (entityId) query = query.eq("entity_id", entityId);
    if (userId) query = query.eq("user_id", userId);
    if (action) query = query.eq("action", action);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/audit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
