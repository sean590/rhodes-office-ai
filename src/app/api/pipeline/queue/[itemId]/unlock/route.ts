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

import { NextResponse, after } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { processQueueItem, generateBatchSummary } from "@/lib/pipeline/worker";
import { analyzePdfWithPassword } from "@/lib/pipeline/pdf-processor";
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
    const db = createOrgClient(orgId);

    // Cross-tenant guard — same shape as the other queue routes.
    const { data: item } = await db
      .from("document_queue")
      .select("id, batch_id, status, file_path")
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

    // Validate the password FAST (just open the encrypted PDF), then run the
    // slow extraction (download → analyze → agent → write) in the BACKGROUND
    // via after(). Awaiting the full pipeline here blocked the request ~38s+
    // per doc; with concurrent unlocks the client fetch timed out / "Failed
    // to fetch" even though processing succeeded server-side.
    if (!item.file_path) {
      return NextResponse.json({ error: "Document file is missing" }, { status: 500 });
    }
    const { data: fileData, error: dlErr } = await db.raw.storage
      .from("documents")
      .download(item.file_path as string);
    if (dlErr || !fileData) {
      return NextResponse.json({ error: "Could not read the document" }, { status: 500 });
    }
    const buffer = Buffer.from(await fileData.arrayBuffer());
    try {
      await analyzePdfWithPassword(buffer, password);
    } catch {
      // PDF wouldn't open with this password → wrong password. Immediate
      // feedback; the item stays password_required for a retry.
      return NextResponse.json({ error: "Incorrect password" }, { status: 400 });
    }

    // Password is correct — process in the background. The password is captured
    // in this closure only; never persisted. processQueueItem claims the item
    // (password_required → extracting), so the cron worker won't also grab it.
    const batchId = item.batch_id as string;
    after(async () => {
      try {
        await processQueueItem(itemId, { password });
        const { count: remainingLocked } = await db
          .from("document_queue")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batchId)
          .eq("status", "password_required");
        if (!remainingLocked) {
          await generateBatchSummary(db.raw, batchId, "post-unlock").catch(() => {});
        }
      } catch (err) {
        console.error("[UNLOCK] background processing failed:", err);
      }
    });

    return NextResponse.json({ success: true, status: "processing" });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/unlock error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
