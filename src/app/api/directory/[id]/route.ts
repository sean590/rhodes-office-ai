import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { requireDelete } from "@/lib/utils/authz";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * GET /api/directory/[id] — one directory entry plus its enumerated roles
 * across the org's entities (manager / member / cap-table / trust role), with
 * entity names resolved. Powers the unified People record page (Phase 6b-2).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const { id } = await params;
    const admin = createAdminClient();

    const { data: entry } = await admin
      .from("directory_entries")
      .select("id, name, type, email, aliases, organization_id, deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (!entry || entry.organization_id !== orgId || entry.deleted_at) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [managers, members, capTable, trustRoles] = await Promise.all([
      admin.from("entity_managers").select("entity_id").eq("directory_entry_id", id),
      admin.from("entity_members").select("entity_id").eq("directory_entry_id", id),
      admin.from("cap_table_entries").select("entity_id").eq("investor_directory_id", id),
      admin.from("trust_roles").select("role, trust_detail_id").eq("directory_entry_id", id),
    ]);

    // trust_roles point at a trust_detail; resolve that to the owning entity.
    const trustDetailIds = (trustRoles.data ?? []).map((r) => r.trust_detail_id).filter(Boolean);
    const trustDetailEntity: Record<string, string> = {};
    if (trustDetailIds.length) {
      const { data: tds } = await admin.from("trust_details").select("id, entity_id").in("id", trustDetailIds);
      for (const td of tds ?? []) trustDetailEntity[td.id] = td.entity_id;
    }

    const raw: { kind: string; entity_id: string }[] = [];
    for (const m of managers.data ?? []) if (m.entity_id) raw.push({ kind: "Manager", entity_id: m.entity_id });
    for (const m of members.data ?? []) if (m.entity_id) raw.push({ kind: "Member", entity_id: m.entity_id });
    for (const c of capTable.data ?? []) if (c.entity_id) raw.push({ kind: "Cap table holder", entity_id: c.entity_id });
    for (const t of trustRoles.data ?? []) {
      const eid = trustDetailEntity[t.trust_detail_id];
      if (eid) raw.push({ kind: titleCase(t.role), entity_id: eid });
    }

    const entityIds = [...new Set(raw.map((r) => r.entity_id))];
    const nameMap: Record<string, string> = {};
    if (entityIds.length) {
      const { data: ents } = await admin.from("entities").select("id, name").in("id", entityIds);
      for (const e of ents ?? []) nameMap[e.id] = e.name;
    }

    const roles = raw
      .filter((r) => nameMap[r.entity_id])
      .map((r) => ({ kind: r.kind, entity_id: r.entity_id, entity_name: nameMap[r.entity_id] }));

    return NextResponse.json({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      email: entry.email,
      aliases: entry.aliases ?? [],
      roles,
    });
  } catch (err) {
    console.error("GET /api/directory/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
    const reqCtx = getRequestContext(reqHeaders, orgId);
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
    const ctx = await requireDelete();
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
    const reqCtx = getRequestContext(reqHeaders, orgId);
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
