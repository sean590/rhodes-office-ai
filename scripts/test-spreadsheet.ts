/**
 * One-off: download a real .xlsx from prod storage and run it through the new
 * spreadsheet→text parser, to confirm it produces readable CSV (not garbage)
 * before we rely on it in the agent.
 *
 * Run: npx tsx scripts/test-spreadsheet.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  // Load .env.local before importing anything that reads process.env at load.
  const envPath = resolve(__dirname, "../.env.local");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1].trim()] = v;
    }
  }

  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { spreadsheetToText } = await import("../src/lib/pipeline/spreadsheet");
  const admin = createAdminClient();

  const { data: items } = await admin
    .from("document_queue")
    .select("id, original_filename, file_path")
    .ilike("original_filename", "%.xlsx")
    .limit(3);

  if (!items || items.length === 0) {
    console.log("No .xlsx queue items found.");
    return;
  }

  for (const it of items) {
    console.log(`\n========== ${it.original_filename} ==========`);
    const { data: file, error } = await admin.storage.from("documents").download(it.file_path);
    if (error || !file) { console.log("  download failed:", error?.message); continue; }
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const text = await spreadsheetToText(buf, it.original_filename);
      console.log(text.slice(0, 1500));
      console.log(`  … [${text.length} chars total]`);
    } catch (e) {
      console.log("  parse failed:", e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
