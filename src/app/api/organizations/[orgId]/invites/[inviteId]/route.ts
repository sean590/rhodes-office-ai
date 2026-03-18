import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { sendEmail } from "@/lib/email";
import { orgInviteEmail } from "@/lib/email-templates";
import { randomUUID } from "crypto";

/**
 * PATCH /api/organizations/[orgId]/invites/[inviteId]
 * Resend an invite — generates a new token, resets expiry, sends email.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, inviteId } = await params;

  if (user.orgId !== orgId || (user.orgRole !== "owner" && user.orgRole !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Fetch the invite
  const { data: invite, error: fetchErr } = await admin
    .from("organization_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("organization_id", orgId)
    .in("status", ["pending"])
    .single();

  if (fetchErr || !invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // Generate new token and expiry (7 days from now)
  const newToken = randomUUID();
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: updated, error: updateErr } = await admin
    .from("organization_invites")
    .update({
      token: newToken,
      expires_at: newExpiry,
    })
    .eq("id", inviteId)
    .select()
    .single();

  if (updateErr || !updated) {
    return NextResponse.json({ error: "Failed to resend invite" }, { status: 500 });
  }

  // Send the email with the new token
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai";
  const inviteUrl = `${appUrl}/invite/${newToken}`;
  await sendEmail({
    to: invite.email,
    subject: `You've been invited to ${user.orgName} on Rhodes`,
    html: orgInviteEmail({
      orgName: user.orgName,
      inviterName: user.display_name || user.email,
      role: invite.role,
      inviteUrl,
    }),
  });

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.invite.resent",
    resourceType: "organization_invite",
    resourceId: inviteId,
    metadata: { email: invite.email, role: invite.role },
    ipAddress,
    userAgent,
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/organizations/[orgId]/invites/[inviteId]
 * Revoke an invite.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, inviteId } = await params;

  // Only owner/admin can revoke invites
  if (user.orgId !== orgId || (user.orgRole !== "owner" && user.orgRole !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("organization_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("organization_id", orgId)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: "Failed to revoke invite" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.invite.revoked",
    resourceType: "organization_invite",
    resourceId: inviteId,
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ success: true });
}
