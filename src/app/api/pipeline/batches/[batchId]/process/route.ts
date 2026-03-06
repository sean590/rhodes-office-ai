import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processBatch } from "@/lib/pipeline/worker";
import { rateLimit } from "@/lib/utils/rate-limit";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";
import { requireOrg, isError } from "@/lib/utils/org-context";

// Allow up to 5 minutes for batch processing
export const maxDuration = 300;

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

    if (!(await rateLimit(`pipeline-process:${user.id}`, 5, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

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

    // Move all staged items to queued
    const { data: items, error: updateError } = await admin
      .from("document_queue")
      .update({
        status: 'queued',
        updated_at: new Date().toISOString(),
      })
      .eq("batch_id", batchId)
      .eq("status", 'staged')
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const queuedCount = items?.length || 0;

    // Update batch status
    await admin
      .from("document_batches")
      .update({
        status: 'processing',
        queued_count: queuedCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    // Schedule processing to run after the response is sent.
    // next/server `after()` keeps the serverless function alive.
    after(async () => {
      try {
        await processBatch(batchId, 3);
      } catch (err) {
        console.error(`Background batch processing failed for ${batchId}:`, err);
      }
    });

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "process_batch",
      resourceType: "pipeline",
      resourceId: batchId,
      metadata: { queued_count: queuedCount },
      ...reqCtx,
    });

    return NextResponse.json({ queued: queuedCount });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/process error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
