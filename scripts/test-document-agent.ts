/**
 * Run the document agent against a single queue item end-to-end.
 *
 * Usage: npx tsx scripts/test-document-agent.ts <queue_item_id>
 *
 * Loads the file from storage, runs runDocumentAgent against it, prints
 * every tool call + final outcome. Does NOT update the queue item's
 * status — this is for verifying agent behavior on a real document
 * before we wire it into the worker. Side effects on other tables (txn
 * links, doc updates) DO happen, since the agent calls write tools
 * directly. Run on a queue item you're OK with the agent mutating, or
 * roll back manually after.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  // Same env-loading pattern as kick-stuck-queue-items.ts: load .env.local
  // before any module that reads process.env at import time.
  const envPath = resolve(__dirname, "../.env.local");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY missing after loading .env.local");
    process.exit(1);
  }

  const itemId = process.argv[2];
  if (!itemId) {
    console.error("Usage: npx tsx scripts/test-document-agent.ts <queue_item_id>");
    process.exit(1);
  }

  // Dynamic imports — these depend on env being loaded first.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { runDocumentAgent } = await import("../src/lib/pipeline/document-agent");

  const admin = createAdminClient();

  // Fetch the queue item + its batch (for orgId).
  const { data: item, error: itemErr } = await admin
    .from("document_queue")
    .select(
      "id, batch_id, document_id, original_filename, file_path, mime_type, document_batches!fk_queue_batch(organization_id, user_context)",
    )
    .eq("id", itemId)
    .single();
  if (itemErr || !item) {
    console.error("Failed to fetch queue item:", itemErr?.message);
    process.exit(1);
  }
  // The join field type is awkward — coalesce both shapes (object | array).
  const batch = Array.isArray(item.document_batches)
    ? item.document_batches[0]
    : item.document_batches;
  const orgId = batch?.organization_id as string;
  if (!orgId) {
    console.error("Queue item has no batch / orgId");
    process.exit(1);
  }

  // Download the file from storage.
  const { data: fileBlob, error: fileErr } = await admin.storage
    .from("documents")
    .download(item.file_path as string);
  if (fileErr || !fileBlob) {
    console.error("Failed to download file:", fileErr?.message);
    process.exit(1);
  }
  const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

  console.log(
    `[TEST] Running document agent on ${itemId}\n` +
      `       filename: ${item.original_filename}\n` +
      `       mime: ${item.mime_type}\n` +
      `       size: ${fileBuffer.length} bytes\n` +
      `       orgId: ${orgId}\n` +
      `       documentId: ${item.document_id || "(none)"}\n`,
  );

  const result = await runDocumentAgent({
    queueItemId: item.id as string,
    documentId: (item.document_id as string | null) ?? null,
    orgId,
    fileBuffer,
    mimeType: item.mime_type as string | null,
    filename: item.original_filename as string,
    userContext: (batch?.user_context as string | null) ?? null,
  });

  console.log("\n=== Tool calls ===");
  for (const [i, call] of result.toolCalls.entries()) {
    const status = call.ok ? "✓" : "✗";
    console.log(`${i + 1}. ${status} ${call.name}`);
    console.log(`     input:  ${JSON.stringify(call.input)}`);
    if (call.resultPreview) {
      console.log(`     result: ${call.resultPreview}`);
    }
  }

  console.log("\n=== Outcome ===");
  console.log(`status:  ${result.status}`);
  console.log(`tokens:  ${result.tokensUsed}`);
  console.log(`summary: ${result.summary}`);
  if (result.deferReason) {
    console.log(`defer:   ${result.deferReason}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
