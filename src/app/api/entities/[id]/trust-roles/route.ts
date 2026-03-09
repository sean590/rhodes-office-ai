import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();

    const { role, name, directory_entry_id, ref_entity_id } = body;

    if (!role || !name) {
      return NextResponse.json(
        { error: "role and name are required" },
        { status: 400 }
      );
    }

    // Get the trust_details for this entity to find the trust_detail_id
    const { data: trustDetails, error: trustError } = await supabase
      .from("trust_details")
      .select("id")
      .eq("entity_id", id)
      .maybeSingle();

    if (trustError) {
      return NextResponse.json({ error: trustError.message }, { status: 500 });
    }

    if (!trustDetails) {
      return NextResponse.json(
        { error: "No trust details found for this entity" },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("trust_roles")
      .insert({
        trust_detail_id: trustDetails.id,
        role,
        name,
        directory_entry_id: directory_entry_id || null,
        ref_entity_id: ref_entity_id || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "trust_role",
      resourceId: id,
      entityId: id,
      metadata: { role, name },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/trust-roles error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();

    const { role_id } = body;

    if (!role_id) {
      return NextResponse.json(
        { error: "role_id is required" },
        { status: 400 }
      );
    }

    // Verify the role belongs to a trust_detail of this entity
    const { data: trustDetails, error: trustError } = await supabase
      .from("trust_details")
      .select("id")
      .eq("entity_id", id)
      .maybeSingle();

    if (trustError) {
      return NextResponse.json({ error: trustError.message }, { status: 500 });
    }

    if (!trustDetails) {
      return NextResponse.json(
        { error: "No trust details found for this entity" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("trust_roles")
      .delete()
      .eq("id", role_id)
      .eq("trust_detail_id", trustDetails.id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "trust_role",
      resourceId: id,
      entityId: id,
      metadata: { role_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/trust-roles error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
