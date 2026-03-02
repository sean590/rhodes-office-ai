import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

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
