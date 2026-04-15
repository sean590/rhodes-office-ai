import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ACTIVITY_COOKIE = "rhodes_last_activity";
const SESSION_START_COOKIE = "rhodes_session_start";

/** Set fresh session timeout cookies on a redirect response */
function setFreshSessionCookies(response: NextResponse): NextResponse {
  const now = Date.now().toString();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24,
  };
  response.cookies.set(ACTIVITY_COOKIE, now, cookieOpts);
  response.cookies.set(SESSION_START_COOKIE, now, cookieOpts);
  return response;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const admin = createAdminClient();

      // 1. Check if user already has an org membership
      const { data: membership } = await admin
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();

      if (membership) {
        // Existing member — ensure profile exists and is up to date
        await ensureUserRecords(admin, data.user);

        const { data: existingProfile } = await admin
          .from("user_profiles")
          .select("active_organization_id")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!existingProfile?.active_organization_id) {
          await admin.from("user_profiles")
            .update({ active_organization_id: membership.organization_id })
            .eq("id", data.user.id);
        }

        if (next) {
          return setFreshSessionCookies(NextResponse.redirect(`${origin}${next}`));
        }
        return setFreshSessionCookies(NextResponse.redirect(`${origin}/dashboard`));
      }

      // 2. Check for pending invite by email
      const { data: invite } = await admin
        .from("organization_invites")
        .select("id, organization_id, role, token")
        .eq("email", data.user.email!)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (invite) {
        // Invited user — create profile so invite acceptance works
        await ensureUserRecords(admin, data.user);

        const response = setFreshSessionCookies(NextResponse.redirect(`${origin}/invite/${invite.token}`));
        response.cookies.set("invite_token", invite.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 3600,
        });
        return response;
      }

      // 3. No membership, no invite — deny access
      //    Sign out so there's no lingering session
      //    Do NOT create user_profiles or users records
      await supabase.auth.signOut();
      const email = encodeURIComponent(data.user.email || "");
      return NextResponse.redirect(`${origin}/access-restricted?email=${email}`);
    }
  }

  // Auth error — redirect back to login
  return NextResponse.redirect(`${origin}/login`);
}

/** Create users + user_profiles records if they don't exist yet */
async function ensureUserRecords(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string; user_metadata?: Record<string, string> }
) {
  const displayName = user.user_metadata?.full_name || null;
  const avatarUrl = user.user_metadata?.avatar_url || null;

  // Legacy users table
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("external_id", user.id)
    .maybeSingle();

  if (!existingUser) {
    await admin.from("users").insert({
      external_id: user.id,
      email: user.email!,
      name: displayName || user.email?.split("@")[0] || "User",
      role: "viewer",
      avatar_url: avatarUrl,
    });
  }

  // user_profiles
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) {
    await admin.from("user_profiles")
      .update({ display_name: displayName, avatar_url: avatarUrl })
      .eq("id", user.id);
  } else {
    await admin.from("user_profiles").insert({
      id: user.id,
      role: "viewer",
      display_name: displayName,
      avatar_url: avatarUrl,
    });
  }
}
