import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { findDirectoryMatch, normalizeName } from "@/lib/utils/name-matching";

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

    const { name, directory_entry_id, ref_entity_id } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Resolve directory entry by name + aliases (with punctuation normalization)
    let resolvedDirId = directory_entry_id || null;
    if (!resolvedDirId) {
      const { data: dirEntries } = await supabase
        .from("directory_entries")
        .select("id, name, aliases");
      if (dirEntries) {
        const match = findDirectoryMatch(name, dirEntries);
        if (match) resolvedDirId = match.id;
      }
    }

    const { data, error } = await supabase
      .from("entity_members")
      .insert({
        entity_id: id,
        name,
        directory_entry_id: resolvedDirId,
        ref_entity_id: ref_entity_id || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "A member with this name already exists for this entity" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Auto-create cap table entry if one doesn't exist for this person (normalized matching)
    const { data: allCap } = await supabase
      .from("cap_table_entries")
      .select("id, investor_name, investor_directory_id")
      .eq("entity_id", id);

    const normalizedName = normalizeName(name);
    const existingCap = (allCap || []).find(
      (c) => normalizeName(c.investor_name || "") === normalizedName
    );

    if (!existingCap) {
      await supabase
        .from("cap_table_entries")
        .insert({
          entity_id: id,
          investor_name: name,
          investor_type: "individual",
          ownership_pct: 0,
          capital_contributed: 0,
          investor_directory_id: resolvedDirId,
        });
    } else if (resolvedDirId && !existingCap.investor_directory_id) {
      await supabase
        .from("cap_table_entries")
        .update({ investor_directory_id: resolvedDirId })
        .eq("id", existingCap.id);
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "entity_member",
      resourceId: id,
      entityId: id,
      metadata: { name },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/members error:", err);
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

    const { member_id } = body;

    if (!member_id) {
      return NextResponse.json(
        { error: "member_id is required" },
        { status: 400 }
      );
    }

    // Fetch the member name before deleting
    const { data: member } = await supabase
      .from("entity_members")
      .select("name")
      .eq("id", member_id)
      .single();

    // Verify the member belongs to this entity
    const { error } = await supabase
      .from("entity_members")
      .delete()
      .eq("id", member_id)
      .eq("entity_id", id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "entity_member",
      resourceId: id,
      entityId: id,
      metadata: { member_id, name: member?.name },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
