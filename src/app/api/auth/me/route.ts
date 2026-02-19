import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("role, display_name, avatar_url")
      .eq("id", user.id)
      .single();

    console.log("[auth/me] user.id:", user.id, "profile:", profile, "profileError:", profileError);

    // Auto-create profile if it doesn't exist
    if (!profile) {
      // Check if any admins exist — first user gets admin role
      const { count: adminCount } = await admin
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");

      const role = adminCount === 0 ? "admin" : "viewer";

      const { data: newProfile } = await admin
        .from("user_profiles")
        .insert({
          id: user.id,
          role,
          display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
        })
        .select("role, display_name, avatar_url")
        .single();

      return NextResponse.json({
        id: user.id,
        email: user.email || "",
        role: newProfile?.role || role,
        display_name: newProfile?.display_name || null,
        avatar_url: newProfile?.avatar_url || null,
      });
    }

    // Bootstrap: if no admins exist at all, promote this user to admin
    const { count: adminCount } = await admin
      .from("user_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    console.log("[auth/me] adminCount:", adminCount, "profile.role:", profile.role);

    if (adminCount === 0) {
      const { data: updated } = await admin
        .from("user_profiles")
        .update({ role: "admin", updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("role, display_name, avatar_url")
        .single();

      return NextResponse.json({
        id: user.id,
        email: user.email || "",
        role: updated?.role || "admin",
        display_name: updated?.display_name || null,
        avatar_url: updated?.avatar_url || null,
      });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email || "",
      role: profile.role,
      display_name: profile.display_name || null,
      avatar_url: profile.avatar_url || null,
    });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
