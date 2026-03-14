/**
 * Periodic inference job — runs full org-wide pattern detection.
 * Scheduled daily via Vercel cron.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runInferenceEngine } from "@/lib/utils/inference-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get all active organizations
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name");

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ message: "No organizations to process" });
  }

  const results: Array<{ org_id: string; org_name: string; patterns: number; suggestions: number; error?: string }> = [];

  for (const org of orgs) {
    try {
      const result = await runInferenceEngine(org.id);
      results.push({
        org_id: org.id,
        org_name: org.name,
        patterns: result.patterns.length,
        suggestions: result.diagnostics.suggestions_created,
      });
    } catch (err) {
      results.push({
        org_id: org.id,
        org_name: org.name,
        patterns: 0,
        suggestions: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ results, processed_at: new Date().toISOString() });
}
