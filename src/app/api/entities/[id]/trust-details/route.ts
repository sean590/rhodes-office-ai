import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();

    const { trust_type, trust_date, grantor_name, situs_state } = body;

    // Find or create trust_details for this entity
    const fetchResult = await supabase
      .from("trust_details")
      .select("id")
      .eq("entity_id", id)
      .maybeSingle();

    const fetchError = fetchResult.error;
    let trustDetails = fetchResult.data;

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!trustDetails) {
      // Auto-create trust_details if missing
      const { data: created, error: createError } = await supabase
        .from("trust_details")
        .insert({
          entity_id: id,
          trust_type: trust_type || "revocable",
          situs_state: situs_state || "DE",
        })
        .select("id")
        .single();

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }
      trustDetails = created;
    }

    // Build update object
    const updates: Record<string, unknown> = {};
    if (trust_type !== undefined) updates.trust_type = trust_type;
    if (trust_date !== undefined) updates.trust_date = trust_date || null;
    if (grantor_name !== undefined) updates.grantor_name = grantor_name || null;
    if (situs_state !== undefined) updates.situs_state = situs_state || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("trust_details")
      .update(updates)
      .eq("id", trustDetails.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/entities/[id]/trust-details error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
