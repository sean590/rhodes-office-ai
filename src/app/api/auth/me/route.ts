import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/utils/auth";

export async function GET() {
  try {
    // Try getCurrentUser first — returns full profile with org context
    const currentUser = await getCurrentUser();

    if (currentUser) {
      return NextResponse.json({
        id: currentUser.id,
        email: currentUser.email,
        display_name: currentUser.display_name,
        avatar_url: currentUser.avatar_url,
        orgId: currentUser.orgId,
        orgRole: currentUser.orgRole,
        orgName: currentUser.orgName,
      });
    }

    // Fallback: user is authenticated but has no profile yet — bootstrap one
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: newProfile } = await admin
      .from("user_profiles")
      .insert({
        id: user.id,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        avatar_url: user.user_metadata?.avatar_url || null,
      })
      .select("display_name, avatar_url")
      .single();

    return NextResponse.json({
      id: user.id,
      email: user.email || "",
      display_name: newProfile?.display_name || null,
      avatar_url: newProfile?.avatar_url || null,
      orgId: "",
      orgRole: "viewer",
      orgName: "",
    });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
