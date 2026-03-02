import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { z } from "zod";

const updateMemberSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, memberId } = await params;

  // Only owner/admin can change roles
  if (user.orgId !== orgId || (user.orgRole !== "owner" && user.orgRole !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the member to check constraints
  const { data: member } = await admin
    .from("organization_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't change owner's role
  if (member.role === "owner") {
    return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });
  }

  // Admins can't promote to admin
  if (user.orgRole === "admin" && parsed.data.role === "admin") {
    return NextResponse.json({ error: "Only the owner can promote to admin" }, { status: 403 });
  }

  const { data: updated, error } = await admin
    .from("organization_members")
    .update({ role: parsed.data.role })
    .eq("id", memberId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }

  // Keep user_profiles.role in sync
  const profileRoleMap: Record<string, string> = {
    admin: "admin",
    member: "editor",
    viewer: "viewer",
  };
  await admin
    .from("user_profiles")
    .update({ role: profileRoleMap[parsed.data.role] })
    .eq("id", member.user_id);

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.member.role_changed",
    resourceType: "organization_member",
    resourceId: memberId,
    metadata: { newRole: parsed.data.role, userId: member.user_id },
    ipAddress,
    userAgent,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, memberId } = await params;

  // Owner/admin can remove members, or user can remove themselves
  const admin = createAdminClient();

  const { data: member } = await admin
    .from("organization_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't remove the owner
  if (member.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the organization owner" }, { status: 400 });
  }

  const isSelf = member.user_id === user.id;
  const isPrivileged = user.orgId === orgId && (user.orgRole === "owner" || user.orgRole === "admin");

  if (!isSelf && !isPrivileged) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  await admin
    .from("organization_members")
    .delete()
    .eq("id", memberId);

  // Clear active org if removed user's active org is this one
  await admin
    .from("user_profiles")
    .update({ active_organization_id: null })
    .eq("id", member.user_id)
    .eq("active_organization_id", orgId);

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: isSelf ? "organization.member.left" : "organization.member.removed",
    resourceType: "organization_member",
    resourceId: memberId,
    metadata: { userId: member.user_id },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ success: true });
}
