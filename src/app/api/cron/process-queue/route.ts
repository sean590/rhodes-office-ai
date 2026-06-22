/**
 * Durable pipeline worker.
 *
 * The upload path kicks off processing in a single `after()` function capped at
 * 300s — anything past that orphans (items stuck `queued`/`extracting`). This
 * cron is the durable safety net: every couple of minutes it reclaims stuck
 * items and drains `queued` items in bounded chunks, so a batch of any size
 * finishes over successive ticks and nothing stays orphaned.
 *
 * Safety: `processQueueItem` claims atomically (status flip + attempt bump), so
 * this cron and the upload's immediate processBatch can run concurrently
 * without double-processing. Poison pills (docs that die mid-run) are capped by
 * `process_attempts` and dead-lettered to `error` rather than looping forever.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processQueueItem } from "@/lib/pipeline/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

const RECLAIM_AFTER_MS = 5 * 60 * 1000; // `extracting` older than this = orphaned
const MAX_ATTEMPTS = 3; // dead-letter after this many claims
const CLAIM_BUDGET_MS = 100_000; // stop claiming new chunks after ~100s; last chunk finishes
                                 // well under maxDuration AND under the 3-min cron interval,
                                 // so ticks don't overlap (atomic claiming would handle it anyway).
const CHUNK = 5; // process this many concurrently per round

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const start = Date.now();
  const staleCutoff = new Date(Date.now() - RECLAIM_AFTER_MS).toISOString();

  // 1. Dead-letter poison pills: items stuck `extracting` past the cutoff that
  //    have exhausted their attempts — they keep dying mid-run, so stop retrying.
  const { data: deadLettered } = await admin
    .from("document_queue")
    .update({
      status: "error",
      extraction_error: "Exceeded max processing attempts (durable worker)",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "extracting")
    .lt("updated_at", staleCutoff)
    .gte("process_attempts", MAX_ATTEMPTS)
    .select("id");

  // 2. Reclaim the rest of the orphaned `extracting` items → `queued`.
  const { data: reclaimed } = await admin
    .from("document_queue")
    .update({ status: "queued", updated_at: new Date().toISOString() })
    .eq("status", "extracting")
    .lt("updated_at", staleCutoff)
    .lt("process_attempts", MAX_ATTEMPTS)
    .select("id");

  // 3. Drain loop: claim + process chunks until the time budget runs out.
  let processed = 0;
  let failed = 0;
  while (Date.now() - start < CLAIM_BUDGET_MS) {
    const { data: candidates } = await admin
      .from("document_queue")
      .select("id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(CHUNK);
    if (!candidates || candidates.length === 0) break;

    await Promise.all(
      candidates.map(async (c) => {
        try {
          await processQueueItem(c.id as string);
          processed++;
        } catch (err) {
          failed++;
          console.error(`[process-queue] ${c.id} failed:`, err instanceof Error ? err.message : err);
        }
      }),
    );
  }

  return NextResponse.json({
    dead_lettered: deadLettered?.length ?? 0,
    reclaimed: reclaimed?.length ?? 0,
    processed,
    failed,
    duration_ms: Date.now() - start,
  });
}
