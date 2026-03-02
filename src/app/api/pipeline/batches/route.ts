import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { createBatchSchema } from "@/lib/validations";
import { headers } from "next/headers";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || "Invalid input" },
        { status: 400 }
      );
    }
    const { name, context, entity_id, entity_discovery } = parsed.data;

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

    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "create_batch",
      resourceType: "pipeline",
      resourceId: data.id,
      metadata: { context, entity_id: entity_id || null },
      ...ctx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/pipeline/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
