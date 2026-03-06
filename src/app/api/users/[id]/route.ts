import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { user, orgId } = ctx;

    if (user.orgRole !== "admin" && user.orgRole !== "owner") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    // Don't allow deleting yourself
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify target user belongs to the same organization
    const { data: targetMembership } = await admin
      .from("organization_members")
      .select("id")
      .eq("user_id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json({ error: "User not found in organization" }, { status: 404 });
    }

    // Remove org membership
    await admin.from("organization_members").delete().eq("user_id", id).eq("organization_id", orgId);

    // Delete from user_profiles
    await admin.from("user_profiles").delete().eq("id", id);

    // Delete from users table (where external_id matches)
    await admin.from("users").delete().eq("external_id", id);

    // Delete from Supabase Auth
    const { error: authError } = await admin.auth.admin.deleteUser(id);
    if (authError) {
      console.error("Failed to delete auth user:", authError);
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "user",
      resourceId: id,
      metadata: {},
      organizationId: orgId,
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
