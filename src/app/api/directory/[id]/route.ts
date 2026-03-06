import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.type !== undefined) updates.type = body.type;
    if (body.email !== undefined) updates.email = body.email;
    if (body.aliases !== undefined) updates.aliases = Array.isArray(body.aliases) ? body.aliases.filter((a: string) => a.trim()) : [];

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("directory_entries")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Directory entry not found" },
        { status: 404 }
      );
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "directory_entry",
      resourceId: id,
      metadata: { fields_updated: Object.keys(updates).filter(k => k !== "updated_at") },
      ...reqCtx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/directory/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update directory entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const supabase = createAdminClient();

    // Parse body for replacement_id (optional)
    let replacement_id: string | null = null;
    let replacementName: string | null = null;
    try {
      const body = await request.json();
      replacement_id = body.replacement_id || null;
    } catch {
      // No body — that's fine
    }

    // Check usage count before deleting
    const [
      membersResult,
      managersResult,
      trustRolesResult,
      capTableResult,
      relsFromResult,
      relsToResult,
    ] = await Promise.all([
      supabase
        .from("entity_members")
        .select("id", { count: "exact", head: true })
        .eq("directory_entry_id", id),
      supabase
        .from("entity_managers")
        .select("id", { count: "exact", head: true })
        .eq("directory_entry_id", id),
      supabase
        .from("trust_roles")
        .select("id", { count: "exact", head: true })
        .eq("directory_entry_id", id),
      supabase
        .from("cap_table_entries")
        .select("id", { count: "exact", head: true })
        .eq("investor_directory_id", id),
      supabase
        .from("relationships")
        .select("id", { count: "exact", head: true })
        .eq("from_directory_id", id),
      supabase
        .from("relationships")
        .select("id", { count: "exact", head: true })
        .eq("to_directory_id", id),
    ]);

    const usageCount =
      (membersResult.count || 0) +
      (managersResult.count || 0) +
      (trustRolesResult.count || 0) +
      (capTableResult.count || 0) +
      (relsFromResult.count || 0) +
      (relsToResult.count || 0);

    // If entry is in use and no replacement provided, return warning with usage details
    if (usageCount > 0 && !replacement_id) {
      return NextResponse.json(
        {
          warning: `This directory entry is referenced in ${usageCount} ${usageCount === 1 ? "place" : "places"}.`,
          usage_count: usageCount,
          needs_replacement: true,
        },
        { status: 409 }
      );
    }

    // If replacement is provided, re-point all references before deleting
    if (replacement_id && usageCount > 0) {
      // Look up replacement name
      const { data: replacementEntry } = await supabase
        .from("directory_entries")
        .select("name")
        .eq("id", replacement_id)
        .single();
      replacementName = replacementEntry?.name || null;

      // Update all references in parallel
      await Promise.all([
        // entity_members: update directory_entry_id and name
        supabase
          .from("entity_members")
          .update({
            directory_entry_id: replacement_id,
            ...(replacementName ? { name: replacementName } : {}),
          })
          .eq("directory_entry_id", id),
        // entity_managers: update directory_entry_id and name
        supabase
          .from("entity_managers")
          .update({
            directory_entry_id: replacement_id,
            ...(replacementName ? { name: replacementName } : {}),
          })
          .eq("directory_entry_id", id),
        // trust_roles: update directory_entry_id and name
        supabase
          .from("trust_roles")
          .update({
            directory_entry_id: replacement_id,
            ...(replacementName ? { name: replacementName } : {}),
          })
          .eq("directory_entry_id", id),
        // cap_table_entries: update investor_directory_id
        supabase
          .from("cap_table_entries")
          .update({ investor_directory_id: replacement_id })
          .eq("investor_directory_id", id),
        // relationships: update from_directory_id
        supabase
          .from("relationships")
          .update({ from_directory_id: replacement_id })
          .eq("from_directory_id", id),
        // relationships: update to_directory_id
        supabase
          .from("relationships")
          .update({ to_directory_id: replacement_id })
          .eq("to_directory_id", id),
      ]);
    }

    // Now delete the entry
    const { error } = await supabase
      .from("directory_entries")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "directory_entry",
      resourceId: id,
      metadata: { replacement_id, replacement_name: replacementName },
      ...reqCtx,
    });

    return NextResponse.json({ success: true, replaced_with: replacement_id });
  } catch (err) {
    console.error("DELETE /api/directory/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete directory entry" },
      { status: 500 }
    );
  }
}
