import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { userRoleSchema } from "@/lib/validations";
import { headers } from "next/headers";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    // Check current user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: currentProfile } = await admin
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (currentProfile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = userRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const { role } = parsed.data;

    // Don't allow removing your own admin role
    if (id === user.id && role !== "admin") {
      return NextResponse.json({ error: "Cannot change your own admin role" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("user_profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "role_change",
      resourceType: "user",
      resourceId: id,
      metadata: { new_role: role },
      ...ctx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/users/[id]/role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
