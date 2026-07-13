import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireSensitive } from "@/lib/utils/aal";
import { isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

// TODO: migrate to /api/organizations/[orgId]/invites
export async function POST(request: Request) {
  try {
    // Inviting a member is a team-management action → admin+. Uses the
    // authoritative org_role via the capability guard (not the legacy
    // user_profiles.role this route used to read).
    const authCtx = await requireSensitive("members:manage");
    if (isError(authCtx)) return authCtx;
    const { orgId, user } = authCtx;

    const admin = createAdminClient();

    const body = await request.json();
    const { email, role } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const validRole = ["admin", "editor", "viewer"].includes(role) ? role : "viewer";

    // Check if user already exists in auth
    const { data: { users: existingUsers } } = await admin.auth.admin.listUsers();
    const alreadyExists = existingUsers?.some(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    if (alreadyExists) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    // Invite user via Supabase Auth (sends magic link email)
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: `${request.headers.get("origin") || ""}/auth/callback` }
    );

    if (inviteError) {
      console.error("Invite error:", inviteError);
      return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
    }

    // Pre-create their user_profile with the chosen role so they get it on first login
    if (inviteData.user) {
      await admin.from("user_profiles").upsert({
        id: inviteData.user.id,
        role: validRole,
        display_name: null,
        avatar_url: null,
      });
    }

    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "invite",
      resourceType: "user",
      resourceId: inviteData.user?.id ?? null,
      metadata: { email: normalizedEmail, role: validRole },
      ...ctx,
    });

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      role: validRole,
    });
  } catch (err) {
    console.error("POST /api/users/invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
