import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OrgRole } from "@/lib/types/enums";

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  orgId: string;
  orgRole: OrgRole;
  orgName: string;
  // Soft-delete offboarding: when the active org is scheduled for deletion, the
  // app is locked out (requireOrg 403s) except the recovery flow, until either
  // the owner recovers it or the 30-day grace elapses and it's hard-deleted.
  orgDeleted: boolean;
  deletionScheduledFor: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();

  // Fetch profile with active org
  const { data: profile } = await admin
    .from("user_profiles")
    .select("display_name, avatar_url, active_organization_id")
    .eq("id", user.id)
    .single();

  const activeOrgId = profile?.active_organization_id || "";

  let orgRole: OrgRole = "viewer";
  let orgName = "";
  let orgDeleted = false;
  let deletionScheduledFor: string | null = null;

  if (activeOrgId) {
    // Fetch org membership and org (name + soft-delete state) in parallel
    const [memberRes, orgRes] = await Promise.all([
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", activeOrgId)
        .eq("user_id", user.id)
        .single(),
      admin
        .from("organizations")
        .select("name, deleted_at, deletion_scheduled_for")
        .eq("id", activeOrgId)
        .single(),
    ]);

    orgRole = (memberRes.data?.role as OrgRole) || "viewer";
    orgName = orgRes.data?.name || "";
    orgDeleted = Boolean(orgRes.data?.deleted_at);
    deletionScheduledFor = (orgRes.data?.deletion_scheduled_for as string | null) ?? null;
  }

  return {
    id: user.id,
    email: user.email || "",
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
    orgId: activeOrgId,
    orgRole,
    orgName,
    orgDeleted,
    deletionScheduledFor,
  };
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
