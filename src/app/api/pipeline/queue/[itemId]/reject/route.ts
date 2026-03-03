import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    const body = await request.json().catch(() => ({}));

    const { data, error } = await admin
      .from("document_queue")
      .update({
        status: "rejected",
        extraction_error: body.reason || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "reject",
      resourceType: "pipeline_item",
      resourceId: itemId,
      metadata: { reason: body.reason || null },
      ...reqCtx,
    });

    return NextResponse.json({ status: "rejected", item: data });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/reject error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
