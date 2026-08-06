/**
 * Expiry → deletion cron (audit A13 + A8). Starts the retention clock that
 * nothing previously started: without this, an expired-unconverted trial or a
 * canceled subscription's data was retained FOREVER, making the "30 days active
 * DB + 90 days backup" retention promise false in steady state.
 *
 * Single 30-day window (Sean, 2026-08-06): a trial that ends (or a subscription
 * that cancels) leaves the org convertible/data-intact for 30 days; after that
 * this sweep soft-deletes it via the SAME machinery as support offboarding, and
 * the hard-delete cron purges it a day later → 90-day S3 backup. Total active
 * retention ≈ 30 days.
 *
 * Detection:
 *   - Unconverted expired trial = trial_ends_at older than 30d AND no Stripe
 *     subscription ever (stripe_subscription_id IS NULL). We key off "never
 *     subscribed" rather than billing_status because signup leaves status as
 *     'trialing' past expiry (entitlements gates on the date, not the status).
 *   - Canceled subscription = billing_status 'canceled' AND subscription_ended_at
 *     (webhook-stamped) older than 30d.
 * Already-soft-deleted orgs (deleted_at set — e.g. support offboarding) are
 * excluded, so nothing is processed twice.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/utils/audit";

export const maxDuration = 120;

const POST_EXPIRY_GRACE_DAYS = 30; // trial ended this long ago, unconverted
const POST_CANCEL_GRACE_DAYS = 30; // subscription canceled this long ago
const FINAL_BUFFER_DAYS = 1;       // soft-delete → hard-delete safety window
const MAX_ORGS_PER_RUN = 25;
const DAY_MS = 86_400_000;

/** Pure: selection cutoffs + the hard-delete schedule for a soft-delete stamped now. */
export function sweepWindows(now: Date) {
  return {
    expiryCutoff: new Date(now.getTime() - POST_EXPIRY_GRACE_DAYS * DAY_MS).toISOString(),
    cancelCutoff: new Date(now.getTime() - POST_CANCEL_GRACE_DAYS * DAY_MS).toISOString(),
    scheduledFor: new Date(now.getTime() + FINAL_BUFFER_DAYS * DAY_MS).toISOString(),
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const { expiryCutoff, cancelCutoff, scheduledFor } = sweepWindows(now);

  const [{ data: trials }, { data: canceled }] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name")
      .is("deleted_at", null)
      .is("stripe_subscription_id", null)
      .not("trial_ends_at", "is", null)
      .lt("trial_ends_at", expiryCutoff)
      .limit(MAX_ORGS_PER_RUN),
    admin
      .from("organizations")
      .select("id, name")
      .is("deleted_at", null)
      .eq("billing_status", "canceled")
      .not("subscription_ended_at", "is", null)
      .lt("subscription_ended_at", cancelCutoff)
      .limit(MAX_ORGS_PER_RUN),
  ]);

  // Dedup (an org can't be both, but be safe) and bound the batch.
  const byId = new Map<string, { id: string; name: string; reason: string }>();
  for (const o of trials ?? []) byId.set(o.id as string, { id: o.id as string, name: o.name as string, reason: "trial_expired" });
  for (const o of canceled ?? []) if (!byId.has(o.id as string)) byId.set(o.id as string, { id: o.id as string, name: o.name as string, reason: "subscription_canceled" });
  const targets = [...byId.values()].slice(0, MAX_ORGS_PER_RUN);

  if (targets.length === 0) return NextResponse.json({ softDeleted: 0 });

  const results: Array<{ org: string; reason: string; ok: boolean; error?: string }> = [];
  for (const t of targets) {
    // Guarded soft-delete: only if still not deleted (a support offboard or a
    // just-completed conversion between the read and now must win).
    const { data, error } = await admin
      .from("organizations")
      .update({
        deleted_at: nowIso,
        deletion_scheduled_for: scheduledFor,
        billing_status: "canceled",
        updated_at: nowIso,
      })
      .eq("id", t.id)
      .is("deleted_at", null)
      .select("id");
    if (error) {
      console.error(`[expiry-sweep] soft-delete failed for ${t.id}:`, error.message);
      results.push({ org: t.id, reason: t.reason, ok: false, error: error.message });
      continue;
    }
    if (!data?.length) { // lost the race — already deleted/converted; skip quietly
      continue;
    }
    // Compliance trail (survives the eventual hard-delete via the A15 archive).
    await logAuditEvent({
      userId: null,
      action: "organization.auto_offboarded",
      resourceType: "organization",
      resourceId: t.id,
      organizationId: t.id,
      metadata: { reason: t.reason, deletion_scheduled_for: scheduledFor, source: "expiry-sweep-cron" },
    }).catch(() => {});
    console.log(`[expiry-sweep] soft-deleted org ${t.id} ("${t.name}") — ${t.reason}; hard-delete after ${scheduledFor}`);
    results.push({ org: t.id, reason: t.reason, ok: true });
  }

  return NextResponse.json({ softDeleted: results.filter((r) => r.ok).length, results });
}
