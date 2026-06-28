import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/utils/auth";
import { z } from "zod";

// Keep in sync with ABSOLUTE_SESSION_CAP_MS in src/lib/supabase/middleware.ts.
const ABSOLUTE_SESSION_CAP_MS = 12 * 60 * 60 * 1000;

/** Absolute session expiry (login time + 12h) from the rhodes_session_start
 * cookie, so the client can warn before the hard cap. null if not set. */
async function getSessionExpiresAt(): Promise<number | null> {
  const start = (await cookies()).get("rhodes_session_start")?.value;
  if (!start) return null;
  const ms = parseInt(start, 10);
  return Number.isNaN(ms) ? null : ms + ABSOLUTE_SESSION_CAP_MS;
}

export async function GET() {
  try {
    // Try getCurrentUser first — returns full profile with org context
    const currentUser = await getCurrentUser();

    if (currentUser) {
      // Fetch primary_entity_id from user_profiles.
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("user_profiles")
        .select("primary_entity_id")
        .eq("id", currentUser.id)
        .maybeSingle();

      return NextResponse.json({
        id: currentUser.id,
        email: currentUser.email,
        display_name: currentUser.display_name,
        avatar_url: currentUser.avatar_url,
        orgId: currentUser.orgId,
        orgRole: currentUser.orgRole,
        orgName: currentUser.orgName,
        primary_entity_id: profile?.primary_entity_id ?? null,
        session_expires_at: await getSessionExpiresAt(),
      });
    }

    // Fallback: user is authenticated but has no profile yet — bootstrap one
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: newProfile } = await admin
      .from("user_profiles")
      .insert({
        id: user.id,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        avatar_url: user.user_metadata?.avatar_url || null,
      })
      .select("display_name, avatar_url")
      .single();

    return NextResponse.json({
      id: user.id,
      email: user.email || "",
      display_name: newProfile?.display_name || null,
      avatar_url: newProfile?.avatar_url || null,
      orgId: "",
      orgRole: "viewer",
      orgName: "",
    });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const patchSchema = z.object({
  primary_entity_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Validate the entity belongs to the user's org if setting (not clearing).
    if (parsed.data.primary_entity_id) {
      const { data: entity } = await admin
        .from("entities")
        .select("id")
        .eq("id", parsed.data.primary_entity_id)
        .eq("organization_id", currentUser.orgId)
        .maybeSingle();
      if (!entity) {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
    }

    const { error } = await admin
      .from("user_profiles")
      .update({ primary_entity_id: parsed.data.primary_entity_id ?? null })
      .eq("id", currentUser.id);
    if (error) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/auth/me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
