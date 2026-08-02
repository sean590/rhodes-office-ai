/**
 * Background regenerator for AI investment overviews.
 *
 * A material write (document filed to a deal, transaction, transfer, note, …)
 * flips investments.ai_overview_stale via Postgres triggers. This cron drains
 * the stale set in bounded chunks and regenerates each overview, which also
 * debounces a burst of uploads into a single regeneration per investment.
 *
 * Safety: fingerprint-skip inside generateInvestmentOverview avoids an LLM call
 * when a stale flag fired but nothing material changed; failures bump
 * ai_overview_attempts and dead-letter after MAX_ATTEMPTS so a poison row can't
 * loop forever.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvestmentOverview } from "@/lib/investment-overview";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;
const CLAIM_LIMIT = 40; // most stale rows to consider per tick
const CHUNK = 3; // regenerate this many concurrently
const BUDGET_MS = 240_000; // stop starting new work after this; last chunk finishes under maxDuration

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const start = Date.now();

  const { data: stale, error } = await admin
    .from("investments")
    .select("id, organization_id")
    .eq("ai_overview_stale", true)
    .lt("ai_overview_attempts", MAX_ATTEMPTS)
    .order("ai_overview_generated_at", { ascending: true, nullsFirst: true })
    .limit(CLAIM_LIMIT);

  if (error) {
    console.error("[refresh-overviews] claim error:", error);
    return NextResponse.json({ error: "claim failed" }, { status: 500 });
  }

  const rows = stale ?? [];
  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    if (Date.now() - start > BUDGET_MS) break;
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (row) => {
        try {
          const res = await generateInvestmentOverview(admin, row.organization_id as string, row.id as string);
          if (res.skipped) skipped++;
          else regenerated++;
        } catch (err) {
          failed++;
          console.error(`[refresh-overviews] ${row.id} failed:`, err);
          // Count the attempt so a persistently-failing row dead-letters.
          const { data: cur } = await admin
            .from("investments")
            .select("ai_overview_attempts")
            .eq("id", row.id)
            .maybeSingle();
          await admin
            .from("investments")
            .update({ ai_overview_attempts: (Number(cur?.ai_overview_attempts) || 0) + 1 })
            .eq("id", row.id);
        }
      }),
    );
  }

  return NextResponse.json({ considered: rows.length, regenerated, skipped, failed });
}
