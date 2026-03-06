import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "90", 10);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);
    const cutoff = cutoffDate.toISOString().split("T")[0];

    // Fetch pending/overdue obligations due within N days (or already overdue)
    const { data: obligations, error } = await admin
      .from("compliance_obligations")
      .select("*, entities!inner(id, name, type, formation_state)")
      .eq("entities.organization_id", orgId)
      .in("status", ["pending", "overdue"])
      .not("next_due_date", "is", null)
      .lte("next_due_date", cutoff)
      .order("next_due_date", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ obligations: obligations || [] }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("GET /api/compliance/upcoming error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
