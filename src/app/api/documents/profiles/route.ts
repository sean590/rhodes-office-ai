import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { requireSensitive } from "@/lib/utils/aal";
import {
  DOCUMENT_SCOPES,
  getSystemDefaultsForScope,
  type DocumentScope,
} from "@/lib/data/document-defaults";

function isValidScope(s: string): s is DocumentScope {
  return (DOCUMENT_SCOPES as string[]).includes(s);
}

export async function GET(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const url = new URL(request.url);
  const scope = url.searchParams.get("entity_type_scope");

  const admin = createOrgClient(ctx.orgId);
  let query = admin
    .from("document_profiles")
    .select("*")
    .order("entity_type_scope")
    .order("document_type");

  if (scope && isValidScope(scope)) {
    query = query.eq("entity_type_scope", scope);
  }

  const { data, error } = await query;
  if (error) {
    console.error("GET /api/documents/profiles query:", error);
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const body = await request.json();
  const { entity_type_scope, document_type, document_category, enabled, is_required, notes } = body;

  if (!entity_type_scope || !isValidScope(entity_type_scope)) {
    return NextResponse.json({ error: "valid entity_type_scope is required" }, { status: 400 });
  }
  if (!document_type) {
    return NextResponse.json({ error: "document_type is required" }, { status: 400 });
  }

  const admin = createOrgClient(ctx.orgId);
  const { data, error } = await admin
    .from("document_profiles")
    .upsert(
      {
        entity_type_scope,
        document_type,
        document_category: document_category || "other",
        enabled: enabled ?? true,
        is_required: is_required ?? true,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,entity_type_scope,document_type" },
    )
    .select()
    .single();

  if (error) {
    console.error("POST /api/documents/profiles upsert:", error);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

/** Seed profiles for a given scope from ALL_SYSTEM_DEFAULTS. */
export async function PUT(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const body = await request.json();
  const { entity_type_scope } = body;

  if (!entity_type_scope || !isValidScope(entity_type_scope)) {
    return NextResponse.json({ error: "valid entity_type_scope is required" }, { status: 400 });
  }

  const defaults = getSystemDefaultsForScope(entity_type_scope);
  if (defaults.length === 0) {
    return NextResponse.json({ seeded: 0 });
  }

  const admin = createOrgClient(ctx.orgId);
  const rows = defaults.map((d) => ({
    entity_type_scope,
    document_type: d.document_type,
    document_category: d.document_category,
    enabled: true,
    is_required: d.is_required,
    notes: d.notes || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("document_profiles")
    .upsert(rows, {
      onConflict: "organization_id,entity_type_scope,document_type",
      ignoreDuplicates: true,
    });

  if (error) {
    console.error("PUT /api/documents/profiles seed:", error);
    return NextResponse.json({ error: "Failed to seed profiles" }, { status: 500 });
  }
  return NextResponse.json({ seeded: rows.length });
}

export async function DELETE(request: Request) {
  const ctx = await requireSensitive("records:delete");
  if (isError(ctx)) return ctx;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const admin = createOrgClient(ctx.orgId);
  const { error } = await admin
    .from("document_profiles")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("DELETE /api/documents/profiles by id:", error);
    return NextResponse.json({ error: "Failed to delete profile" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
