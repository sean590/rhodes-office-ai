import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const userId = userRow ? user.id : null;

    const { data: item, error: itemError } = await admin
      .from("document_queue")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    if (item.status !== "review_ready") {
      return NextResponse.json({ error: `Cannot ingest item in status: ${item.status}` }, { status: 400 });
    }

    const result = await ingestQueueItem({
      item,
      userId,
      orgId,
      applyMutations: false,
      finalStatus: "approved",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "ingest",
      resourceType: "pipeline_item",
      resourceId: itemId,
      metadata: { batch_id: item.batch_id },
      ...reqCtx,
    });

    return NextResponse.json({
      status: "approved",
      document: result.document,
      actions_applied: 0,
      actions_failed: 0,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/ingest-only error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
