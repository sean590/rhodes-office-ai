import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processBatch } from "@/lib/pipeline/worker";
import { rateLimit } from "@/lib/utils/rate-limit";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!rateLimit(`pipeline-process:${user.id}`, 5, 60000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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

    // Start processing in the background (fire-and-forget)
    processBatch(batchId, 3).catch((err) => {
      console.error(`Background batch processing failed for ${batchId}:`, err);
    });

    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "process_batch",
      resourceType: "pipeline",
      resourceId: batchId,
      metadata: { queued_count: queuedCount },
      ...ctx,
    });

    return NextResponse.json({ queued: queuedCount });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/process error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
