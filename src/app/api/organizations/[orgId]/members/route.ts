import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  // Must be a member of this org
  if (user.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Fetch members with profile info
  const { data: members, error } = await admin
    .from("organization_members")
    .select("id, user_id, role, joined_at")
    .eq("organization_id", orgId)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }

  // Enrich with profile data
  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);

  const { data: users } = await admin
    .from("users")
    .select("external_id, email")
    .in("external_id", userIds);

  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
  const emailMap = new Map(users?.map((u) => [u.external_id, u.email]) ?? []);

  const enriched = members.map((m) => ({
    ...m,
    display_name: profileMap.get(m.user_id)?.display_name || null,
    avatar_url: profileMap.get(m.user_id)?.avatar_url || null,
    email: emailMap.get(m.user_id) || null,
  }));

  // Also fetch pending invites
  const { data: invites } = await admin
    .from("organization_invites")
    .select("id, email, role, status, created_at, expires_at")
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return NextResponse.json({ members: enriched, invites: invites || [] });
}
