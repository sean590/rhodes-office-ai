import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { searchParams } = new URL(request.url);
    const hash = searchParams.get("hash");

    if (!hash) {
      return NextResponse.json({ error: "hash query parameter is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: existing, error } = await admin
      .from("documents")
      .select("id, name, entity_id, created_at")
      .eq("content_hash", hash)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (existing) {
      // Look up entity name
      let entityName: string | null = null;
      if (existing.entity_id) {
        const { data: ent } = await admin
          .from("entities")
          .select("name")
          .eq("id", existing.entity_id)
          .single();
        entityName = ent?.name || null;
      }

      return NextResponse.json({
        is_duplicate: true,
        existing_document: { ...existing, entity_name: entityName },
      });
    }

    return NextResponse.json({ is_duplicate: false });
  } catch (err) {
    console.error("GET /api/documents/check-hash error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
