import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

// GET: Public — returns invite details
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: invite, error } = await admin
    .from("organization_invites")
    .select("id, email, role, status, expires_at, organization_id")
    .eq("token", token)
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // Check expiry
  if (invite.status === "pending" && new Date(invite.expires_at) < new Date()) {
    await admin
      .from("organization_invites")
      .update({ status: "expired" })
      .eq("id", invite.id);
    return NextResponse.json({
      error: "This invite has expired",
      status: "expired",
    }, { status: 410 });
  }

  if (invite.status !== "pending") {
    return NextResponse.json({
      error: `This invite has been ${invite.status}`,
      status: invite.status,
    }, { status: 410 });
  }

  // Fetch org name
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", invite.organization_id)
    .single();

  // Fetch inviter name
  const { data: inviterProfile } = await admin
    .from("organization_invites")
    .select("invited_by")
    .eq("id", invite.id)
    .single();

  let inviterName = "Someone";
  if (inviterProfile?.invited_by) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("display_name")
      .eq("id", inviterProfile.invited_by)
      .single();
    inviterName = profile?.display_name || "Someone";
  }

  return NextResponse.json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    orgName: org?.name || "Unknown Organization",
    inviterName,
    expiresAt: invite.expires_at,
  });
}

// POST: Authenticated — accepts invite
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const admin = createAdminClient();

  const { data: invite, error } = await admin
    .from("organization_invites")
    .select("*")
    .eq("token", token)
    .eq("status", "pending")
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  // Check expiry
  if (new Date(invite.expires_at) < new Date()) {
    await admin
      .from("organization_invites")
      .update({ status: "expired" })
      .eq("id", invite.id);
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Check email matches (case-insensitive)
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({
      error: "This invite was sent to a different email address",
    }, { status: 403 });
  }

  // Check if already a member
  const { data: existing } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", invite.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    // Mark invite as accepted and return success
    await admin
      .from("organization_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    return NextResponse.json({ success: true, orgId: invite.organization_id });
  }

  // Create membership
  await admin.from("organization_members").insert({
    organization_id: invite.organization_id,
    user_id: user.id,
    role: invite.role,
    invited_by: invite.invited_by,
  });

  // Mark invite as accepted
  await admin
    .from("organization_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  // Set as active org
  await admin
    .from("user_profiles")
    .update({ active_organization_id: invite.organization_id })
    .eq("id", user.id);

  // Sync user_profiles.role
  const profileRoleMap: Record<string, string> = {
    owner: "admin",
    admin: "admin",
    member: "editor",
    viewer: "viewer",
  };
  await admin
    .from("user_profiles")
    .update({ role: profileRoleMap[invite.role] || "viewer" })
    .eq("id", user.id);

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.invite.accepted",
    resourceType: "organization_invite",
    resourceId: invite.id,
    metadata: { organizationId: invite.organization_id, role: invite.role },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ success: true, orgId: invite.organization_id });
}
