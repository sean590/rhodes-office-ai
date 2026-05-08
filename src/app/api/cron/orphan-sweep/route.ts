/**
 * Orphan-document sweep — runs periodically to soft-delete documents that
 * never reached a terminal state.
 *
 * The original sin: src/app/api/pipeline/batches/[batchId]/upload/route.ts
 * creates a documents row at register time, BEFORE extraction runs. If the
 * pipeline doesn't reach a terminal state for that queue item — typical
 * causes: session expired mid-upload, a Vercel function killed mid-tool-call,
 * a tool failure that never propagated back to a status update — the
 * documents row sits forever in status='processing' with deleted_at=null.
 *
 * Those rows are invisible to every UI surface but very visible to the
 * hash-based dedupe in /upload's register handler. The result is a
 * particularly nasty failure mode: the next attempt to upload the same
 * file silently dedupes against an orphan that the user can't find.
 *
 * The worker's catch block now soft-deletes documents on extraction error
 * (worker.ts:333-353), which closes most paths. This sweeper is the safety
 * net for everything else: anything where the queue item is in a stuck
 * non-terminal state (`staged`, `queued`, `extracting`) for >2 hours, or
 * where there's no queue item at all. Both cases produce orphan documents.
 *
 * Threshold rationale: 2 hours is well past any reasonable real extraction
 * (the agent's worst-case is single digits of minutes), but short enough
 * that a stuck doc surfaces by next sweep rather than next day.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const STUCK_QUEUE_STATUSES = ["staged", "queued", "extracting", "extracted"];

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  // Path 1: documents whose linked queue item is stuck in a non-terminal,
  // non-user-action state. password_required is intentionally excluded —
  // the user is expected to act on those, and clearing them out from under
  // the user would be a worse UX than the dedupe trap.
  const { data: stuckQueueDocs } = await admin
    .from("document_queue")
    .select("document_id, status, created_at")
    .in("status", STUCK_QUEUE_STATUSES)
    .lt("created_at", cutoff)
    .not("document_id", "is", null);

  const docIdsFromStuckQueue = (stuckQueueDocs ?? [])
    .map((q) => q.document_id as string | null)
    .filter((id): id is string => !!id);

  // Path 2: documents that have no queue row pointing to them at all.
  // Created during register, then the queue row was deleted (e.g., manual
  // SQL cleanup, a botched batch deletion) leaving the document orphaned.
  // We hunt these by finding documents in status='processing' older than
  // the cutoff and checking each for queue presence.
  const { data: ancientProcessingDocs } = await admin
    .from("documents")
    .select("id, content_hash, name, created_at")
    .eq("status", "processing")
    .is("deleted_at", null)
    .lt("created_at", cutoff)
    .limit(500); // bound the sweep — next run picks up the rest

  const docIdsToCheck = (ancientProcessingDocs ?? []).map((d) => d.id as string);
  let docIdsWithNoQueue: string[] = [];
  if (docIdsToCheck.length > 0) {
    const { data: queueLinks } = await admin
      .from("document_queue")
      .select("document_id")
      .in("document_id", docIdsToCheck);
    const linkedIds = new Set(
      (queueLinks ?? [])
        .map((q) => q.document_id as string | null)
        .filter((id): id is string => !!id),
    );
    docIdsWithNoQueue = docIdsToCheck.filter((id) => !linkedIds.has(id));
  }

  // Union, dedupe, and soft-delete.
  const allOrphanIds = Array.from(new Set([...docIdsFromStuckQueue, ...docIdsWithNoQueue]));

  let softDeleted = 0;
  if (allOrphanIds.length > 0) {
    const { error: delErr, count } = await admin
      .from("documents")
      .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
      .in("id", allOrphanIds)
      .is("deleted_at", null);
    if (delErr) {
      console.error("[orphan-sweep] soft-delete failed:", delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    softDeleted = count ?? 0;
  }

  return NextResponse.json({
    cutoff,
    stuck_queue_doc_ids: docIdsFromStuckQueue.length,
    no_queue_doc_ids: docIdsWithNoQueue.length,
    soft_deleted: softDeleted,
  });
}
