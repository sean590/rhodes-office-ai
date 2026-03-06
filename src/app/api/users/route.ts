import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    // Only owner/admin can list members
    if (user.orgRole !== "owner" && user.orgRole !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Get org members with their org roles
    const { data: orgMembers, error: membersError } = await admin
      .from("organization_members")
      .select("user_id, role, joined_at")
      .eq("organization_id", orgId)
      .order("joined_at", { ascending: true });

    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    if (!orgMembers || orgMembers.length === 0) {
      return NextResponse.json([]);
    }

    const memberUserIds = orgMembers.map((m) => m.user_id);
    const orgRoleMap = new Map(orgMembers.map((m) => [m.user_id, m.role]));
    const joinedAtMap = new Map(orgMembers.map((m) => [m.user_id, m.joined_at]));

    // Get user profiles
    const { data: profiles, error } = await admin
      .from("user_profiles")
      .select("*")
      .in("id", memberUserIds);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
      role: orgRoleMap.get(p.id as string) || p.role,
      joined_at: joinedAtMap.get(p.id as string) || p.created_at,
    }));

    // Sort by joined_at
    enriched.sort((a, b) => {
      const dateA = new Date(a.joined_at as string).getTime();
      const dateB = new Date(b.joined_at as string).getTime();
      return dateA - dateB;
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/users error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
