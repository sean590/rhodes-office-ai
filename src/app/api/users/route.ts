import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();

    // Check current user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get all user profiles using admin client
    const { data: profiles, error } = await admin
      .from("user_profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich profiles with email from auth.users
    const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
    const emailMap = new Map<string, string>();
    if (authUsers) {
      for (const u of authUsers) {
        emailMap.set(u.id, u.email || "");
      }
    }

    const enriched = (profiles || []).map((p: Record<string, unknown>) => ({
      ...p,
      email: emailMap.get(p.id as string) || "",
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/users error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
