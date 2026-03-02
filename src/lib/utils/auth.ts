import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserRole, OrgRole } from "@/lib/types/enums";

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  avatar_url: string | null;
  orgId: string;
  orgRole: OrgRole;
  orgName: string;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();

  // Fetch profile with active org
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role, display_name, avatar_url, active_organization_id")
    .eq("id", user.id)
    .single();

  const activeOrgId = profile?.active_organization_id || "";

  let orgRole: OrgRole = "viewer";
  let orgName = "";

  if (activeOrgId) {
    // Fetch org membership and org name in parallel
    const [memberRes, orgRes] = await Promise.all([
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", activeOrgId)
        .eq("user_id", user.id)
        .single(),
      admin
        .from("organizations")
        .select("name")
        .eq("id", activeOrgId)
        .single(),
    ]);

    orgRole = (memberRes.data?.role as OrgRole) || "viewer";
    orgName = orgRes.data?.name || "";
  }

  return {
    id: user.id,
    email: user.email || "",
    role: (profile?.role as UserRole) || "viewer",
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
    orgId: activeOrgId,
    orgRole,
    orgName,
  };
}

export async function requireRole(requiredRole: UserRole): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const roleHierarchy: Record<UserRole, number> = {
    admin: 3,
    editor: 2,
    viewer: 1,
  };

  if (roleHierarchy[user.role] < roleHierarchy[requiredRole]) {
    throw new Error("Insufficient permissions");
  }

  return user;
}

const orgRoleHierarchy: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export async function requireOrgRole(requiredRole: OrgRole): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  if (!user.orgId) {
    throw new Error("No organization");
  }

  if (orgRoleHierarchy[user.orgRole] < orgRoleHierarchy[requiredRole]) {
    throw new Error("Insufficient organization permissions");
  }

  return user;
}
