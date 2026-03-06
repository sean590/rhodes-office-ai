import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { batchId } = await params;
    const admin = createAdminClient();

    // Verify batch belongs to this org
    const { data: batch, error: batchError } = await admin
      .from("document_batches")
      .select("id")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const userId = userRow ? user.id : null;

    const { data: items, error } = await admin
      .from("document_queue")
      .select("*")
      .eq("batch_id", batchId)
      .eq("status", "review_ready");

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ approved: 0, skipped: 0, errors: [] });
    }

    const results = { approved: 0, skipped: 0, errors: [] as string[] };

    for (const item of items) {
      const result = await ingestQueueItem({
        item,
        userId,
        orgId,
        applyMutations: true,
        finalStatus: "approved",
      });

      if (result.success) {
        results.approved++;
      } else {
        results.errors.push(`${item.id}: ${result.error}`);
      }
    }

    results.skipped = items.length - results.approved - results.errors.length;

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "approve_batch",
      resourceType: "pipeline",
      resourceId: batchId,
      metadata: { approved: results.approved, skipped: results.skipped, error_count: results.errors.length },
      ...reqCtx,
    });

    return NextResponse.json(results);
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/approve-all error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
