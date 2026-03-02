import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { sendEmail } from "@/lib/email";
import { orgInviteEmail } from "@/lib/email-templates";
import { z } from "zod";

const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  // Only owner/admin can invite
  if (user.orgId !== orgId || (user.orgRole !== "owner" && user.orgRole !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, role } = parsed.data;
  const admin = createAdminClient();

  // Check if already a member
  const { data: existingUsers } = await admin
    .from("users")
    .select("external_id")
    .eq("email", email)
    .limit(1);

  if (existingUsers && existingUsers.length > 0) {
    const { data: existingMember } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", existingUsers[0].external_id)
      .maybeSingle();

    if (existingMember) {
      return NextResponse.json({ error: "This user is already a member" }, { status: 409 });
    }
  }

  // Check for pending invite to same email
  const { data: existingInvite } = await admin
    .from("organization_invites")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvite) {
    return NextResponse.json({ error: "An invite is already pending for this email" }, { status: 409 });
  }

  // Create invite
  const { data: invite, error } = await admin
    .from("organization_invites")
    .insert({
      organization_id: orgId,
      email,
      role,
      invited_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }

  // Send invite email
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai";
  const inviteUrl = `${appUrl}/invite/${invite.token}`;
  await sendEmail({
    to: email,
    subject: `You've been invited to ${user.orgName} on Rhodes`,
    html: orgInviteEmail({
      orgName: user.orgName,
      inviterName: user.display_name || user.email,
      role,
      inviteUrl,
    }),
  });

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.invite.sent",
    resourceType: "organization_invite",
    resourceId: invite.id,
    metadata: { email, role },
    ipAddress,
    userAgent,
  });

  return NextResponse.json(invite, { status: 201 });
}
