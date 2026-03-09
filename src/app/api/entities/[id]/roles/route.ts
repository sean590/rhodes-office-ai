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

    const { role_title, name, directory_entry_id, ref_entity_id } = body;

    if (!role_title) {
      return NextResponse.json({ error: "role_title is required" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("entity_roles")
      .insert({
        entity_id: id,
        role_title,
        name,
        directory_entry_id: directory_entry_id || null,
        ref_entity_id: ref_entity_id || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This person already has this role for this entity" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "entity_role",
      resourceId: id,
      entityId: id,
      metadata: { role_title, name },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/roles error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

    const { error } = await supabase
      .from("entity_roles")
      .delete()
      .eq("id", role_id)
      .eq("entity_id", id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "entity_role",
      resourceId: id,
      entityId: id,
      metadata: { role_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/roles error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
