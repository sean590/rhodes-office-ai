import { createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/types/enums";

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  avatar_url: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, display_name, avatar_url")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email || "",
    role: (profile?.role as UserRole) || "viewer",
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
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
