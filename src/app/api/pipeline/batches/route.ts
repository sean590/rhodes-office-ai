import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, context = 'global', entity_id, entity_discovery = false } = body;

    // Check if user exists in public users table (auth user may not be synced yet)
    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const { data, error } = await admin
      .from("document_batches")
      .insert({
        name: name || null,
        context,
        entity_id: entity_id || null,
        entity_discovery,
        created_by: userRow ? user.id : null,
      })
      .select()
      .single();

    if (error) {
      console.error("Create batch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/pipeline/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
