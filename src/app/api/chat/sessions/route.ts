import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      .select("*")
      .eq("user_id", internalUser.id)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/chat/sessions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        title,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/chat/sessions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
