import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/entities";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Auto-create user record on first login
      const admin = createAdminClient();
      const { data: existingUser } = await admin
        .from("users")
        .select("id")
        .eq("external_id", data.user.id)
        .single();

      if (!existingUser) {
        await admin.from("users").insert({
          external_id: data.user.id,
          email: data.user.email!,
          name:
            data.user.user_metadata?.full_name ||
            data.user.email?.split("@")[0] ||
            "User",
          role: "viewer",
          avatar_url: data.user.user_metadata?.avatar_url,
        });
      }

      // Ensure user_profiles row exists and update name/avatar from OAuth
      const displayName = data.user.user_metadata?.full_name || null;
      const avatarUrl = data.user.user_metadata?.avatar_url || null;

      const { data: existingProfile } = await admin
        .from("user_profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (existingProfile) {
        // Update name/avatar on each login (picks up Google profile info)
        await admin.from("user_profiles")
          .update({ display_name: displayName, avatar_url: avatarUrl })
          .eq("id", data.user.id);
      } else {
        await admin.from("user_profiles").insert({
          id: data.user.id,
          role: "viewer",
          display_name: displayName,
          avatar_url: avatarUrl,
        });
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect back to login
  return NextResponse.redirect(`${origin}/login`);
}
