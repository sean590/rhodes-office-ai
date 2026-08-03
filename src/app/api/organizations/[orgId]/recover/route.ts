/**
 * POST /api/organizations/[orgId]/recover
 *
 * Owner-only recovery of a soft-deleted org within its 30-day grace. Clears the
 * deletion flags → access is restored exactly as it was (nothing was purged).
 * Uses getCurrentUser directly (not requireOrg) since requireOrg locks out a
 * soft-deleted org.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (user.orgId !== orgId || user.orgRole !== "owner") {
      return NextResponse.json({ error: "Only the organization owner can recover the account." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("deleted_at, deletion_scheduled_for")
      .eq("id", orgId)
      .single();
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (!org.deleted_at) {
      return NextResponse.json({ error: "This organization is not scheduled for deletion." }, { status: 409 });
    }

    // Past the grace window the hard-delete may already have run (or is imminent)
    // — recovery is no longer safe/possible.
    if (org.deletion_scheduled_for && new Date(org.deletion_scheduled_for as string).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "The recovery window has passed — this account can no longer be recovered." },
        { status: 410 },
      );
    }

    await admin
      .from("organizations")
      .update({
        deleted_at: null,
        deletion_scheduled_for: null,
        deleted_by: null,
        billing_status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId);

    const reqCtx = getRequestContext(request.headers, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "organization.deletion_cancelled",
      resourceType: "organization",
      resourceId: orgId,
      organizationId: orgId,
      metadata: {},
      ...reqCtx,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/organizations/[orgId]/recover error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
