/**
 * POST /api/entities/[id]/compliance/sync — manual re-sync trigger.
 * Thin wrapper over the shared syncComplianceForEntity function.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { syncComplianceForEntity } from "@/lib/utils/compliance-sync";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const result = await syncComplianceForEntity(id, orgId);

    const supabase = await createClient();
    const { data: updated } = await supabase
      .from("compliance_obligations")
      .select("*")
      .eq("entity_id", id)
      .order("next_due_date", { ascending: true, nullsFirst: false });

    const reqHeaders = await headers();
    await logAuditEvent({
      userId: user.id,
      action: "sync_compliance",
      resourceType: "compliance",
      resourceId: id,
      entityId: id,
      metadata: { obligations_synced: result.generated },
      ...getRequestContext(reqHeaders, orgId),
    });

    return NextResponse.json({
      obligations: updated ?? [],
      generated_count: result.generated,
    });
  } catch (err) {
    console.error("POST /api/entities/[id]/compliance/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
