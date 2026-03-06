import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();

    // Resolve internal user ID from auth external_id
    const { data: internalUser } = await admin
      .from("users")
      .select("id")
      .eq("external_id", user.id)
      .single();

    if (!internalUser) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 });
    }

    const { data, error } = await admin
      .from("chat_sessions")
      .select("id, title, user_id, organization_id, created_at, updated_at")
      .eq("user_id", internalUser.id)
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/chat/sessions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();

    // Resolve internal user ID from auth external_id
    const { data: internalUser } = await admin
      .from("users")
      .select("id")
      .eq("external_id", user.id)
      .single();

    if (!internalUser) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const title = body.title || "New Chat";

    const { data, error } = await admin
      .from("chat_sessions")
      .insert({
        user_id: internalUser.id,
        organization_id: orgId,
        title,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/chat/sessions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
