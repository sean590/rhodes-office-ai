/**
 * Backfill content_hash for existing documents.
 * Downloads each file from Supabase Storage, computes SHA-256, and updates the record.
 * Run with: npx tsx scripts/backfill-content-hashes.ts
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

// Parse .env.local manually
const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
}

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log("=== Backfilling content hashes ===\n");

  // Fetch documents missing content_hash
  const { data: docs, error } = await admin
    .from("documents")
    .select("id, name, file_path")
    .is("content_hash", null)
    .is("deleted_at", null)
    .order("created_at");

  if (error) {
    console.error("Failed to fetch documents:", error.message);
    process.exit(1);
  }

  if (!docs || docs.length === 0) {
    console.log("No documents need backfilling.");
    return;
  }

  console.log(`Found ${docs.length} documents to backfill.\n`);

  let success = 0;
  let failed = 0;
  const duplicates: { hash: string; docs: string[] }[] = [];
  const hashMap = new Map<string, string[]>();

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const progress = `[${i + 1}/${docs.length}]`;

    try {
      // Download file from storage
      const { data: fileData, error: downloadError } = await admin.storage
        .from("documents")
        .download(doc.file_path);

      if (downloadError || !fileData) {
        console.error(`${progress} FAILED ${doc.name}: ${downloadError?.message || "No data"}`);
        failed++;
        continue;
      }

      // Compute SHA-256
      const arrayBuffer = await fileData.arrayBuffer();
      const hash = createHash("sha256").update(Buffer.from(arrayBuffer)).digest("hex");

      // Update record
      const { error: updateError } = await admin
        .from("documents")
        .update({ content_hash: hash })
        .eq("id", doc.id);

      if (updateError) {
        console.error(`${progress} FAILED ${doc.name}: ${updateError.message}`);
        failed++;
        continue;
      }

      // Track for duplicate detection
      const existing = hashMap.get(hash) || [];
      existing.push(`${doc.name} (${doc.id})`);
      hashMap.set(hash, existing);

      console.log(`${progress} OK ${doc.name} -> ${hash.slice(0, 12)}...`);
      success++;
    } catch (err) {
      console.error(`${progress} FAILED ${doc.name}:`, err);
      failed++;
    }
  }

  // Report duplicates
  for (const [hash, docNames] of hashMap) {
    if (docNames.length > 1) {
      duplicates.push({ hash, docs: docNames });
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  Success: ${success}`);
  console.log(`  Failed: ${failed}`);

  if (duplicates.length > 0) {
    console.log(`\n=== Duplicates Found (${duplicates.length}) ===`);
    for (const dup of duplicates) {
      console.log(`  Hash: ${dup.hash.slice(0, 16)}...`);
      for (const name of dup.docs) {
        console.log(`    - ${name}`);
      }
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
