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

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect back to login
  return NextResponse.redirect(`${origin}/login`);
}
