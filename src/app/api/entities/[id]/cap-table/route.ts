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

    const { investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date, investor_entity_id, investor_directory_id } = body;

    if (!investor_name) {
      return NextResponse.json({ error: "investor_name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("cap_table_entries")
      .insert({
        entity_id: id,
        investor_name,
        investor_type: investor_type || "individual",
        units: units ?? null,
        ownership_pct: ownership_pct || 0,
        capital_contributed: capital_contributed ?? 0,
        investment_date: investment_date || null,
        investor_entity_id: investor_entity_id || null,
        investor_directory_id: investor_directory_id || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "cap_table_entry",
      resourceId: id,
      metadata: { investor_name },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/cap-table error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
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

    const { entry_id, investor_name, investor_type, units, ownership_pct, capital_contributed, investment_date } = body;

    if (!entry_id) {
      return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (investor_name !== undefined) updates.investor_name = investor_name;
    if (investor_type !== undefined) updates.investor_type = investor_type;
    if (units !== undefined) updates.units = units;
    if (ownership_pct !== undefined) updates.ownership_pct = ownership_pct;
    if (capital_contributed !== undefined) updates.capital_contributed = capital_contributed;
    if (investment_date !== undefined) updates.investment_date = investment_date || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("cap_table_entries")
      .update(updates)
      .eq("id", entry_id)
      .eq("entity_id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "cap_table_entry",
      resourceId: id,
      metadata: { entry_id },
      ...reqCtx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/entities/[id]/cap-table error:", err);
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

    const { entry_id } = body;

    if (!entry_id) {
      return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("cap_table_entries")
      .delete()
      .eq("id", entry_id)
      .eq("entity_id", id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "cap_table_entry",
      resourceId: id,
      metadata: { entry_id },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/cap-table error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
