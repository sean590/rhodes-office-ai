/**
 * POST /api/signup/complete
 *
 * Finishes self-serve signup for a freshly-authenticated user who has no org
 * yet: creates their TRIAL organization (30-day clock), owner membership, and
 * records the clickwrap consent. The two qualifying answers are stored on the
 * org. Guarded so a user who already belongs to an org can't create a second.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
// Bootstraps a brand-new org (no org context exists yet); same as organizations POST.
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestContext, logAuditEvent } from "@/lib/utils/audit";
import { recordConsent, CONSENT_DOC_VERSION } from "@/lib/billing/consent";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { SIGNUP_ENABLED } from "@/lib/features";
import { z } from "zod";

const schema = z.object({
  orgName: z.string().trim().min(1).max(120),
  entityCount: z.enum(["1", "2-5", "6-15", "16+"]),
  role: z.enum(["family_office_principal", "family_office_staff", "advisor", "accountant", "other"]),
  agreedToTerms: z.literal(true),
});

export async function POST(request: Request) {
  try {
    // Server-side kill-switch: self-serve signup is closed while the Google
    // OAuth app is under verification. The /signup page and /auth/callback also
    // gate on this, but enforce it here too so the org-creating endpoint can't
    // be hit directly.
    if (!SIGNUP_ENABLED) {
      return NextResponse.json({ error: "Signup is not open yet." }, { status: 403 });
    }

    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Please complete all fields and accept the terms." }, { status: 400 });
    }
    const { orgName, entityCount, role } = parsed.data;

    const admin = createAdminClient();

    // Guard: a user who already belongs to an org can't self-serve a second one.
    const { data: existing } = await admin
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "You already belong to an organization." }, { status: 409 });
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name: orgName,
        slug: `${slug}-${Date.now().toString(36)}`,
        billing_email: user.email,
        created_by: user.id,
        billing_plan: "trial",
        billing_status: "trialing",
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnds.toISOString(),
        signup_answers: { entity_count: entityCount, role },
      })
      .select("id")
      .single();
    if (orgErr || !org) {
      console.error("[signup] org create failed:", orgErr);
      return NextResponse.json({ error: "Could not create your account." }, { status: 500 });
    }

    await admin.from("organization_members").insert({ organization_id: org.id, user_id: user.id, role: "owner" });
    await admin.from("user_profiles").update({ active_organization_id: org.id }).eq("id", user.id);

    // Clickwrap consent (ARL/legal trail) — captured at account creation with
    // the proof context. Best-effort but logged.
    const reqCtx = getRequestContext(request.headers, org.id);
    await recordConsent(admin, {
      organizationId: org.id,
      userId: user.id,
      consentType: "signup_clickwrap",
      documentVersion: CONSENT_DOC_VERSION,
      ipAddress: reqCtx.ipAddress ?? null,
      userAgent: reqCtx.userAgent ?? null,
      metadata: { plan: "trial" },
    });

    // Provision the org's hosted inbound address (best-effort — never fail signup).
    try {
      const { getOrCreateInboundAddress } = await import("@/lib/inbound/ses");
      await getOrCreateInboundAddress(admin, org.id, user.id);
    } catch (err) {
      console.error("[signup] inbound address provisioning failed:", err);
    }

    await logAuditEvent({
      userId: user.id,
      action: "organization.created",
      resourceType: "organization",
      resourceId: org.id,
      organizationId: org.id,
      metadata: { name: orgName, via: "signup", plan: "trial" },
      ...reqCtx,
    }).catch(() => {});

    return NextResponse.json({ orgId: org.id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/signup/complete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
