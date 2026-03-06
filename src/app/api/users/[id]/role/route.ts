import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { userRoleSchema } from "@/lib/validations";
import { headers } from "next/headers";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetUserId } = await params;
    const orgCtx = await requireOrg();
    if (isError(orgCtx)) return orgCtx;
    const { orgId, user } = orgCtx;

    // Only owner/admin can change roles
    if (user.orgRole !== "owner" && user.orgRole !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const admin = createAdminClient();

    const body = await request.json();
    const parsed = userRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const { role } = parsed.data;

    // Don't allow changing your own role
    if (targetUserId === user.id) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    // Don't allow non-owners to set someone to admin
    if (role === "admin" && user.orgRole !== "owner") {
      return NextResponse.json({ error: "Only owners can promote to admin" }, { status: 403 });
    }

    // Check target user is a member of this org
    const { data: membership, error: memberError } = await admin
      .from("organization_members")
      .select("id, role")
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId)
      .single();

    if (memberError || !membership) {
      return NextResponse.json({ error: "User not found in this organization" }, { status: 404 });
    }

    // Don't allow changing an owner's role (owners can only be changed by themselves or via transfer)
    if (membership.role === "owner") {
      return NextResponse.json({ error: "Cannot change an owner's role" }, { status: 403 });
    }

    // Update organization_members role
    const { error: updateError } = await admin
      .from("organization_members")
      .update({ role })
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "role_change",
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { new_role: role, organization_id: orgId },
      ...ctx,
    });

    return NextResponse.json({ success: true, role });
  } catch (err) {
    console.error("PUT /api/users/[id]/role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
