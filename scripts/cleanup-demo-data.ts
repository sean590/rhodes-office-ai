/**
 * One-off script to hard-delete demo/test data.
 * Run with: npx tsx scripts/cleanup-demo-data.ts
 */

import { createClient } from "@supabase/supabase-js";
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

const ENTITIES_TO_DELETE = [
  "Demetree Holdings LLC",
  "Demetree Capital Partners LLC",
  "Tall Oil Processing Co LLC",
  "Palisades Development LLC",
  "Chemical Derivatives Fund I LLC",
  "Awary Technologies LLC",
  "Demetree Family Trust",
];

const DIRECTORY_ENTRIES_TO_DELETE = [
  "Baker McKenzie",
  "Coastal Ventures LP",
  "David Park",
  "Emily Demetree",
  "External Investors",
  "Greenfield Family Office",
  "J. Harrison Trust",
  "James Wright",
  "Lauren Demetree",
  "Maria Chen",
  "Sean Demetree",
];

async function main() {
  console.log("=== Cleaning up demo data ===\n");

  // 1. Look up entity IDs
  const { data: entities } = await admin
    .from("entities")
    .select("id, name")
    .in("name", ENTITIES_TO_DELETE);

  const entityIds = (entities || []).map((e) => e.id);
  console.log(`Found ${entityIds.length} entities to delete:`);
  (entities || []).forEach((e) => console.log(`  - ${e.name} (${e.id})`));

  // 2. Look up directory entry IDs
  const { data: dirEntries } = await admin
    .from("directory_entries")
    .select("id, name")
    .in("name", DIRECTORY_ENTRIES_TO_DELETE);

  const dirIds = (dirEntries || []).map((d) => d.id);
  console.log(`\nFound ${dirIds.length} directory entries to delete:`);
  (dirEntries || []).forEach((d) => console.log(`  - ${d.name} (${d.id})`));

  if (entityIds.length === 0 && dirIds.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  // 3. Delete relationships referencing these entities or directory entries
  console.log("\n--- Deleting relationships ---");
  if (entityIds.length > 0) {
    const r1 = await admin.from("relationships").delete().in("from_entity_id", entityIds);
    console.log(`  Deleted from_entity relationships: ${r1.error ? r1.error.message : "ok"}`);
    const r2 = await admin.from("relationships").delete().in("to_entity_id", entityIds);
    console.log(`  Deleted to_entity relationships: ${r2.error ? r2.error.message : "ok"}`);
  }
  if (dirIds.length > 0) {
    const r3 = await admin.from("relationships").delete().in("from_directory_id", dirIds);
    console.log(`  Deleted from_directory relationships: ${r3.error ? r3.error.message : "ok"}`);
    const r4 = await admin.from("relationships").delete().in("to_directory_id", dirIds);
    console.log(`  Deleted to_directory relationships: ${r4.error ? r4.error.message : "ok"}`);
  }

  // 4. Clean up directory entry references in other tables
  if (dirIds.length > 0) {
    console.log("\n--- Cleaning directory references ---");
    const m1 = await admin.from("entity_members").delete().in("directory_entry_id", dirIds);
    console.log(`  entity_members: ${m1.error ? m1.error.message : "ok"}`);
    const m2 = await admin.from("entity_managers").delete().in("directory_entry_id", dirIds);
    console.log(`  entity_managers: ${m2.error ? m2.error.message : "ok"}`);
    const m3 = await admin.from("trust_roles").delete().in("directory_entry_id", dirIds);
    console.log(`  trust_roles: ${m3.error ? m3.error.message : "ok"}`);
    const m4 = await admin.from("cap_table_entries").delete().in("investor_directory_id", dirIds);
    console.log(`  cap_table_entries: ${m4.error ? m4.error.message : "ok"}`);
  }

  // 5. Clean up entity cross-references (ref_entity_id in members/managers)
  if (entityIds.length > 0) {
    console.log("\n--- Cleaning entity cross-references ---");
    // Null out ref_entity_id rather than deleting the member/manager records
    const u1 = await admin.from("entity_members").update({ ref_entity_id: null }).in("ref_entity_id", entityIds);
    console.log(`  entity_members ref_entity_id: ${u1.error ? u1.error.message : "ok"}`);
    const u2 = await admin.from("entity_managers").update({ ref_entity_id: null }).in("ref_entity_id", entityIds);
    console.log(`  entity_managers ref_entity_id: ${u2.error ? u2.error.message : "ok"}`);
    // cap_table investor_entity_id
    const u3 = await admin.from("cap_table_entries").update({ investor_entity_id: null }).in("investor_entity_id", entityIds);
    console.log(`  cap_table investor_entity_id: ${u3.error ? u3.error.message : "ok"}`);
  }

  // 6. Delete entities (cascades to registrations, members, managers, trust_details, cap_table, custom_fields, documents, filings)
  if (entityIds.length > 0) {
    console.log("\n--- Deleting entities ---");
    const del = await admin.from("entities").delete().in("id", entityIds);
    console.log(`  Result: ${del.error ? del.error.message : "ok"}`);
  }

  // 7. Delete directory entries
  if (dirIds.length > 0) {
    console.log("\n--- Deleting directory entries ---");
    const del = await admin.from("directory_entries").delete().in("id", dirIds);
    console.log(`  Result: ${del.error ? del.error.message : "ok"}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
