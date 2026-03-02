import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

// TODO: migrate to /api/organizations/[orgId]/invites
export async function POST(request: Request) {
  try {
    const orgCtx = await requireOrg();
    if (isError(orgCtx)) return orgCtx;
    const { orgId: _orgId } = orgCtx;

    const supabase = await createClient();
    const admin = createAdminClient();

    // Check current user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await admin
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

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
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
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
    const ctx = getRequestContext(reqHeaders);
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
