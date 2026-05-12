/**
 * POST /api/pipeline/queue/[itemId]/unlock
 *
 * Inline UI fallback for password-protected PDFs. The chat-side flow uses
 * the `unlock_document` MCP tool — both call into the same processQueueItem
 * with a transient password. The password is used in-process for decryption
 * and is NEVER persisted to the queue row, batch metadata, or any other
 * field; only the extracted text (post-decryption) is stored.
 *
 * On success the queue item moves to review_ready (or auto_ingested), the
 * batch's status recomputes, and the bell + /review surfaces refresh via
 * Realtime. On wrong password we return a 400 — the UI surfaces the message,
 * the user retries.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processQueueItem, generateBatchSummary } from "@/lib/pipeline/worker";
import { requireOrg, isError } from "@/lib/utils/org-context";

// Unlock awaits the full pipeline (download → analyze → agent → write tools).
// Real K-1s have hit ~38s on a single agent loop; concurrent unlocks of 4
// files all running the agent in parallel will exceed the 60s default and
// kill the function mid-tool-call, leaving rows in transient states. Max
// allowed on Vercel Pro is 300s.
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    // Cross-tenant guard — same shape as the other queue routes.
    const { data: item } = await admin
      .from("document_queue")
      .select("id, batch_id, status")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }
    const { data: batchOwn } = await admin
      .from("document_batches")
      .select("id")
      .eq("id", item.batch_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!batchOwn) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    if (item.status !== "password_required") {
      return NextResponse.json(
        { error: `Cannot unlock item in status: ${item.status}` },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // Re-run the full extraction pipeline with the password supplied. If
    // the password is wrong, processQueueItem will throw inside extraction
    // and the queue item will land back in password_required (worker
    // catches PdfPasswordRequiredError) — return a 400 to the caller.
    try {
      await processQueueItem(itemId, { password });
    } catch (err) {
      console.error("Unlock failed:", err);
      return NextResponse.json(
        { error: "Failed to unlock document" },
        { status: 500 },
      );
    }

    // Re-fetch to surface the new status to the caller. Three terminal
    // states matter here:
    //   password_required → password was wrong, ask the user again
    //   error             → password worked but extraction failed downstream
    //                       (e.g. corrupt PDF, AI extraction error). Report
    //                       this rather than claiming success.
    //   anything else     → genuine success (extracted/review_ready/etc.)
    const { data: refreshed } = await admin
      .from("document_queue")
      .select("status, extraction_error, batch_id")
      .eq("id", itemId)
      .maybeSingle();
    if (refreshed?.status === "password_required") {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 400 },
      );
    }
    if (refreshed?.status === "error") {
      return NextResponse.json(
        {
          error:
            refreshed.extraction_error ||
            "Document was unlocked but extraction failed afterwards.",
        },
        { status: 500 },
      );
    }

    // Auto-summary (phase 2, "post-unlock"): if this unlock finished off
    // the last password_required item in the batch, fire a summary so the
    // user gets a "now everything's done" message in the originating chat
    // session. We check by counting remaining locked items.
    if (refreshed?.batch_id) {
      const { count: remainingLocked } = await admin
        .from("document_queue")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", refreshed.batch_id as string)
        .eq("status", "password_required");
      if (!remainingLocked || remainingLocked === 0) {
        // Fire-and-forget; the user shouldn't wait on this for the
        // unlock response to return.
        generateBatchSummary(admin, refreshed.batch_id as string, "post-unlock").catch((err) =>
          console.error(`[UNLOCK] post-unlock summary failed:`, err),
        );
      }
    }

    return NextResponse.json({ success: true, status: refreshed?.status ?? "unknown" });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/unlock error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
