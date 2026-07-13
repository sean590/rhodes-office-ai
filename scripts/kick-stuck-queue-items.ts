/**
 * One-off: find queue items stuck in status="queued" or status="error"
 * (typically split children created before the splitter learned to fire
 * processQueueItem itself, plus retries from a previous bad run) and kick
 * off extraction for each.
 *
 * Run with: npx tsx scripts/kick-stuck-queue-items.ts
 *
 * Note: dynamic imports are deliberate. ES module imports are hoisted to
 * the top of the file regardless of source position; static imports of
 * the worker / supabase client would initialize the Anthropic SDK before
 * we've populated process.env from .env.local, and the SDK would then
 * have no API key and every extraction would fail with "Could not resolve
 * authentication method".
 */

import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  // Load .env.local FIRST, before any module that reads process.env at
  // module-load time (the Anthropic SDK is one such module).
  const envPath = resolve(__dirname, "../.env.local");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      // Strip surrounding quotes if any.
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1].trim()] = value;
    }
  }

  // Sanity check the keys we need before pulling in worker code.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY not in env after loading .env.local. " +
        "Without it the worker will fail every extraction.",
    );
    process.exit(1);
  }

  // NOW dynamically import — at this point process.env is populated and
  // the Anthropic SDK will pick up the key on its first init.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { processQueueItem } = await import("../src/lib/pipeline/worker");
  const admin = createAdminClient();

  const { data: items, error } = await admin
    .from("document_queue")
    .select("id, original_filename, batch_id, parent_queue_id, split_depth, status")
    .in("status", ["queued", "error"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Query failed:", error);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log("No stuck items in status=queued or status=error.");
    return;
  }

  console.log(`Found ${items.length} stuck items:`);
  for (const it of items) {
    console.log(
      `  ${it.id}  [${it.status}]  ${it.original_filename}  ` +
        `(batch=${it.batch_id}, parent=${it.parent_queue_id || "none"}, depth=${it.split_depth})`,
    );
  }

  // Reset error items back to queued so processQueueItem doesn't refuse on
  // a status guard.
  const errorIds = items.filter((i) => i.status === "error").map((i) => i.id);
  if (errorIds.length > 0) {
    console.log(`\nResetting ${errorIds.length} error items back to queued...`);
    const { error: resetErr } = await admin
      .from("document_queue")
      .update({ status: "queued", extraction_error: null })
      .in("id", errorIds);
    if (resetErr) {
      console.error("Reset failed:", resetErr);
      process.exit(1);
    }
  }

  console.log("\nKicking off extraction (sequential, so log lines stay readable)...");
  for (const it of items) {
    try {
      await processQueueItem(it.id);
      console.log(`  ✓ ${it.id} processed.`);
    } catch (err) {
      console.error(`  ✗ ${it.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
