import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_document_overrides")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const body = await request.json();
  const { document_type, action, reason } = body;

  if (!document_type) {
    return NextResponse.json({ error: "document_type is required" }, { status: 400 });
  }
  if (!action || !["disable", "enable"].includes(action)) {
    return NextResponse.json({ error: "action must be 'disable' or 'enable'" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Replace any existing override for this document_type, then insert.
  await admin
    .from("org_document_overrides")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("document_type", document_type);

  const { data, error } = await admin
    .from("org_document_overrides")
    .insert({
      organization_id: ctx.orgId,
      document_type,
      action,
      reason: reason || null,
      created_by: ctx.user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const documentType = url.searchParams.get("document_type");

  const admin = createAdminClient();

  if (id) {
    const { error } = await admin
      .from("org_document_overrides")
      .delete()
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (documentType) {
    const { error } = await admin
      .from("org_document_overrides")
      .delete()
      .eq("document_type", documentType)
      .eq("organization_id", ctx.orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or document_type is required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
