// Internal account offboarding — support-run ops script.
//
// Account/data deletion is INTERNAL-ONLY (no self-serve UI): a customer requests
// offboarding via a support ticket and we run this. It uses the recoverable
// soft-delete machinery (migration 089) — it does NOT purge data. It sets a
// 30-day grace during which the org is locked out of the app but fully
// recoverable (owner self-serve, or `recover` here). A cron hard-deletes it
// only after the grace elapses (Increment B).
//
// This is deliberately NOT wired to Stripe. Cancelling a subscription is a
// separate billing action that must never delete data; offboarding is this.
//
// Usage (env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
//   set -a; source .env.local; set +a
//   node scripts/offboarding/offboard-org.mjs status   <orgId>
//   node scripts/offboarding/offboard-org.mjs schedule <orgId> "<exact org name>"
//   node scripts/offboarding/offboard-org.mjs recover  <orgId>
//
// `schedule` requires the exact org name as a second arg — a deliberate
// fat-finger guard against scheduling the wrong org.

import { createClient } from "@supabase/supabase-js";

const GRACE_DAYS = 30;
const [, , mode, orgId, confirmName] = process.argv;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (source .env.local first).");
  process.exit(1);
}
if (!mode || !orgId || !["status", "schedule", "recover"].includes(mode)) {
  console.error("Usage: offboard-org.mjs <status|schedule|recover> <orgId> [\"exact org name\" for schedule]");
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: org, error } = await db
  .from("organizations")
  .select("id, name, deleted_at, deletion_scheduled_for, billing_status")
  .eq("id", orgId)
  .maybeSingle();
if (error) { console.error("Query failed:", error.message); process.exit(1); }
if (!org) { console.error(`No organization with id ${orgId}.`); process.exit(1); }

const fmt = (d) => (d ? new Date(d).toISOString() : "—");
const printState = (o) =>
  console.log(`  org: "${o.name}" (${o.id})\n  deleted_at: ${fmt(o.deleted_at)}\n  scheduled_for: ${fmt(o.deletion_scheduled_for)}\n  billing: ${o.billing_status}`);

if (mode === "status") {
  printState(org);
  process.exit(0);
}

if (mode === "schedule") {
  if (org.deleted_at) {
    console.error(`Already scheduled for deletion (${fmt(org.deletion_scheduled_for)}). Use 'recover' to cancel.`);
    process.exit(1);
  }
  if ((confirmName ?? "").trim() !== (org.name ?? "").trim()) {
    console.error(`Name mismatch guard: pass the exact org name as the 3rd arg.\n  expected: "${org.name}"\n  got:      "${confirmName ?? ""}"`);
    process.exit(1);
  }
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const { error: upErr } = await db
    .from("organizations")
    .update({
      deleted_at: now.toISOString(),
      deletion_scheduled_for: scheduledFor.toISOString(),
      billing_status: "canceled",
      updated_at: now.toISOString(),
    })
    .eq("id", orgId);
  if (upErr) { console.error("Update failed:", upErr.message); process.exit(1); }
  console.log(`✓ Scheduled "${org.name}" for deletion.`);
  console.log(`  Locked out now; recoverable until ${scheduledFor.toISOString()} (${GRACE_DAYS}-day grace).`);
  console.log(`  The owner can self-recover in-app, or run: offboard-org.mjs recover ${orgId}`);
  process.exit(0);
}

if (mode === "recover") {
  if (!org.deleted_at) { console.error("Not scheduled for deletion — nothing to recover."); process.exit(1); }
  if (org.deletion_scheduled_for && new Date(org.deletion_scheduled_for).getTime() <= Date.now()) {
    console.error("Grace window has passed — the org may already be hard-deleted; cannot recover here.");
    process.exit(1);
  }
  const { error: upErr } = await db
    .from("organizations")
    .update({
      deleted_at: null,
      deletion_scheduled_for: null,
      deleted_by: null,
      billing_status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  if (upErr) { console.error("Update failed:", upErr.message); process.exit(1); }
  console.log(`✓ Recovered "${org.name}" — access restored, nothing was purged.`);
  process.exit(0);
}
