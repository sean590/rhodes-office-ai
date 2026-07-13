import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";
import { requireOrg, isError } from "@/lib/utils/org-context";

// Approving a large batch applies mutations per item; give it a budget so it
// doesn't hit the default timeout on a big "Approve all".
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
    const db = createOrgClient(orgId);

    // Verify batch belongs to this org
    const { data: batch, error: batchError } = await db
      .from("document_batches")
      .select("id")
      .eq("id", batchId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const { data: userRow } = await db.raw
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const userId = userRow ? user.id : null;

    const { data: items, error } = await db
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

    // Bounded-concurrency, not serial: a large "Approve all" applied one item at
    // a time hit the function timeout. The items are independent ingests, so we
    // run them in chunks (cap the concurrency so we don't fan out unbounded DB
    // writes). Aggregate counts don't depend on order.
    const CONCURRENCY = 5;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(
        items.slice(i, i + CONCURRENCY).map(async (item: Record<string, unknown>) => {
          try {
            const r = await ingestQueueItem({
              item,
              userId,
              orgId,
              applyMutations: true,
              finalStatus: "approved",
            });
            return { item, success: r.success, error: r.error };
          } catch (err) {
            console.error(`POST /api/pipeline/batches/[batchId]/approve-all ingest item ${item.id}:`, err);
            return { item, success: false, error: "Ingest failed" };
          }
        }),
      );
      for (const o of outcomes) {
        if (o.success) results.approved++;
        else {
          if (o.error) console.error(`POST /api/pipeline/batches/[batchId]/approve-all item ${o.item.id} failed:`, o.error);
          results.errors.push(`${o.item.id}: Ingest failed`);
        }
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
