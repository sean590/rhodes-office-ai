/**
 * Background regenerator for AI overviews (investments + entities).
 *
 * A material write (document filed, transaction, transfer, note, member/manager,
 * compliance obligation, …) flips ai_overview_stale via Postgres triggers. This
 * cron drains the stale set for each record type in bounded chunks and
 * regenerates, which also debounces a burst of writes into a single regen.
 *
 * Safety: fingerprint-skip inside the generators avoids an LLM call when a stale
 * flag fired but nothing material changed; failures bump ai_overview_attempts
 * and dead-letter after MAX_ATTEMPTS so a poison row can't loop forever.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvestmentOverview } from "@/lib/investment-overview";
import { generateEntityOverview } from "@/lib/entity-overview";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;
const CLAIM_LIMIT = 40; // most stale rows to consider per type per tick
const CHUNK = 3; // regenerate this many concurrently
const BUDGET_MS = 240_000; // stop starting new work after this; last chunk finishes under maxDuration

type Admin = ReturnType<typeof createAdminClient>;

/** Drain one record type's stale set. Mutates the counters object. */
async function drain(
  admin: Admin,
  table: "investments" | "entities",
  generate: (org: string, id: string) => Promise<{ skipped: boolean }>,
  start: number,
  counters: { regenerated: number; skipped: number; failed: number; considered: number },
): Promise<void> {
  const { data: stale, error } = await admin
    .from(table)
    .select("id, organization_id")
    .eq("ai_overview_stale", true)
    .lt("ai_overview_attempts", MAX_ATTEMPTS)
    .order("ai_overview_generated_at", { ascending: true, nullsFirst: true })
    .limit(CLAIM_LIMIT);
  if (error) {
    console.error(`[refresh-overviews] ${table} claim error:`, error);
    return;
  }
  const rows = stale ?? [];
  counters.considered += rows.length;

  for (let i = 0; i < rows.length; i += CHUNK) {
    if (Date.now() - start > BUDGET_MS) break;
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (row) => {
        try {
          const res = await generate(row.organization_id as string, row.id as string);
          if (res.skipped) counters.skipped++;
          else counters.regenerated++;
        } catch (err) {
          counters.failed++;
          console.error(`[refresh-overviews] ${table} ${row.id} failed:`, err);
          const { data: cur } = await admin
            .from(table)
            .select("ai_overview_attempts")
            .eq("id", row.id)
            .maybeSingle();
          await admin
            .from(table)
            .update({ ai_overview_attempts: (Number(cur?.ai_overview_attempts) || 0) + 1 })
            .eq("id", row.id);
        }
      }),
    );
  }
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const start = Date.now();
  const counters = { regenerated: 0, skipped: 0, failed: 0, considered: 0 };

  await drain(admin, "investments", (org, id) => generateInvestmentOverview(admin, org, id), start, counters);
  await drain(admin, "entities", (org, id) => generateEntityOverview(admin, org, id), start, counters);

  return NextResponse.json(counters);
}
