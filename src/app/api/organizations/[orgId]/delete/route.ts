/**
 * POST /api/organizations/[orgId]/delete
 *
 * Owner-only account offboarding (single-org model). Soft-deletes the org with a
 * 30-day recoverable grace: locks the org out of the app immediately, but keeps
 * ALL data intact so the owner can recover it exactly as-is. A cron hard-deletes
 * it once the grace elapses (Increment B).
 *
 * Substantial confirmation required: the caller must re-type the org name AND
 * re-enter their password (guards a hijacked / left-open session).
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { z } from "zod";

const GRACE_DAYS = 30;

const schema = z.object({
  confirmName: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Owner of THIS org only.
    if (user.orgId !== orgId || user.orgRole !== "owner") {
      return NextResponse.json({ error: "Only the organization owner can delete the account." }, { status: 403 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Confirmation name and password are required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("name, deleted_at")
      .eq("id", orgId)
      .single();
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (org.deleted_at) {
      return NextResponse.json({ error: "This organization is already scheduled for deletion." }, { status: 409 });
    }

    // Confirmation 1: exact org name.
    if (parsed.data.confirmName.trim() !== (org.name ?? "").trim()) {
      return NextResponse.json({ error: "The organization name doesn't match." }, { status: 400 });
    }

    // Confirmation 2: re-authenticate the password (throwaway client — we only
    // want the pass/fail, never a persisted session).
    const verifier = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: pwErr } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.password,
    });
    if (pwErr) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
    }

    const now = new Date();
    const scheduledFor = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

    // Soft-delete: lock out now, keep data for the grace window. Cancel billing
    // so they aren't charged during grace. NOTE: no Stripe integration is wired
    // yet — when it lands, cancel the subscription here (stripe_subscription_id).
    await admin
      .from("organizations")
      .update({
        deleted_at: now.toISOString(),
        deletion_scheduled_for: scheduledFor.toISOString(),
        deleted_by: user.id,
        billing_status: "canceled",
        updated_at: now.toISOString(),
      })
      .eq("id", orgId);

    const reqCtx = getRequestContext(request.headers, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "organization.deletion_scheduled",
      resourceType: "organization",
      resourceId: orgId,
      organizationId: orgId,
      metadata: { scheduled_for: scheduledFor.toISOString(), grace_days: GRACE_DAYS },
      ...reqCtx,
    }).catch(() => {});

    // Member notification email is sent in Increment A2 (with the UI).
    return NextResponse.json({ scheduled_for: scheduledFor.toISOString() });
  } catch (err) {
    console.error("POST /api/organizations/[orgId]/delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
