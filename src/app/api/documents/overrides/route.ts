import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const db = createOrgClient(ctx.orgId);
  const { data, error } = await db
    .from("org_document_overrides")
    .select("*")
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

  const db = createOrgClient(ctx.orgId);

  // The org_document_overrides.created_by FK references public.users(id).
  // If the auth user isn't synced (or was synced to a stale id from a
  // previous org/user migration), the insert fails with a FK violation.
  // Mirror the defensive pattern used in /api/pipeline/batches/route.ts:
  // check the public.users row exists first; fall back to null otherwise.
  const { data: userRow } = await db.raw
    .from("users")
    .select("id")
    .eq("id", ctx.user.id)
    .maybeSingle();

  // Replace any existing override for this document_type, then insert.
  await db
    .from("org_document_overrides")
    .delete()
    .eq("document_type", document_type);

  const { data, error } = await db
    .from("org_document_overrides")
    .insert({
      document_type,
      action,
      reason: reason || null,
      created_by: userRow ? ctx.user.id : null,
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

  const db = createOrgClient(ctx.orgId);

  if (id) {
    const { error } = await db
      .from("org_document_overrides")
      .delete()
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (documentType) {
    const { error } = await db
      .from("org_document_overrides")
      .delete()
      .eq("document_type", documentType);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or document_type is required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
