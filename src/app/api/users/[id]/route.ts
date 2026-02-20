import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
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

    // Don't allow deleting yourself
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    // Delete from user_profiles
    await admin.from("user_profiles").delete().eq("id", id);

    // Delete from users table (where external_id matches)
    await admin.from("users").delete().eq("external_id", id);

    // Delete from Supabase Auth
    const { error: authError } = await admin.auth.admin.deleteUser(id);
    if (authError) {
      console.error("Failed to delete auth user:", authError);
      // Don't fail the request — profile is already cleaned up
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
