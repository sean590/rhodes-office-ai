/**
 * POST /api/pipeline/queue/[itemId]/reprocess
 *
 * Retry a stuck document. The Processing surface calls this for items in
 * `error` (and the "Retry all stuck" action loops it). We reset the row to a
 * clean `queued` state (clearing the prior extraction error/timers) and re-run
 * the full pipeline in the background via `after()` so the request returns
 * immediately and the UI can poll the row back to life.
 *
 * Distinct from `/unlock` (which supplies a password for `password_required`
 * items) — this is the no-password retry for genuine extraction failures.
 */

import { NextResponse, after } from "next/server";
import { headers } from "next/headers";
import { createOrgClient } from "@/lib/supabase/org-client";
import { processQueueItem } from "@/lib/pipeline/worker";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

// Reprocessing runs the full agent loop; same ceiling as unlock/process.
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const db = createOrgClient(orgId);

    // Cross-tenant guard — same shape as the other queue routes.
    const { data: item } = await db
      .from("document_queue")
      .select("id, batch_id, status")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }
    const { data: batchOwn } = await db
      .from("document_batches")
      .select("id")
      .eq("id", item.batch_id)
      .maybeSingle();
    if (!batchOwn) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    // Only retry genuinely stuck items. password_required has its own unlock
    // path; terminal/in-flight states shouldn't be re-kicked from here.
    if (item.status !== "error") {
      return NextResponse.json(
        { error: `Cannot reprocess item in status: ${item.status}` },
        { status: 400 },
      );
    }

    // Reset to a clean queued state so the worker treats it as fresh.
    await db
      .from("document_queue")
      .update({
        status: "queued",
        extraction_error: null,
        extraction_started_at: null,
        extraction_completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "reprocess",
      resourceType: "pipeline_item",
      resourceId: itemId,
      metadata: {},
      ...reqCtx,
    });

    // Re-run the pipeline after the response is sent (keeps the function warm).
    after(async () => {
      try {
        await processQueueItem(itemId);
      } catch (err) {
        console.error(`Reprocess of ${itemId} failed:`, err);
      }
    });

    return NextResponse.json({ status: "queued", queue_item_id: itemId });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/reprocess error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
