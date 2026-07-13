import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MFA_STATE_COOKIE, buildMfaStateValue, mfaStateCookieOptions } from "@/lib/utils/mfa-state";

/**
 * POST /api/auth/mfa-state — recompute and re-set the rhodes_mfa_state cookie.
 *
 * The cookie is set at login, but enrollment can change mid-session (a user
 * enrolls or removes their last factor in settings). The client calls this after
 * any factor change so middleware's server-side MFA enforcement stays accurate
 * without a login. Enrollment state comes from listFactors; the grace deadline
 * from user_profiles.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerified =
      (factors?.totp ?? []).some((f) => f.status === "verified") ||
      (factors?.phone ?? []).some((f) => f.status === "verified");

    let graceIso: string | null = null;
    try {
      const admin = createAdminClient();
      const { data: prof } = await admin
        .from("user_profiles")
        .select("mfa_grace_until")
        .eq("id", user.id)
        .maybeSingle();
      graceIso = prof?.mfa_grace_until ?? null;
    } catch {
      /* non-fatal — mfa_grace_until column may be absent pre-migration-070 */
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(
      MFA_STATE_COOKIE,
      buildMfaStateValue(hasVerified, graceIso),
      mfaStateCookieOptions(),
    );
    return res;
  } catch (err) {
    console.error("POST /api/auth/mfa-state error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
