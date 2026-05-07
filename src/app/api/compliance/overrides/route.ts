import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_compliance_overrides")
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
  const { rule_id, action, reason } = body;

  if (!rule_id) return NextResponse.json({ error: "rule_id is required" }, { status: 400 });
  if (!action || !["disable", "enable"].includes(action)) {
    return NextResponse.json({ error: "action must be 'disable' or 'enable'" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Delete any existing override for this rule, then insert.
  await admin
    .from("org_compliance_overrides")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("rule_id", rule_id);

  const { data, error } = await admin
    .from("org_compliance_overrides")
    .insert({
      organization_id: ctx.orgId,
      rule_id,
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
  const ruleId = url.searchParams.get("rule_id");

  const admin = createAdminClient();

  if (id) {
    const { error } = await admin
      .from("org_compliance_overrides")
      .delete()
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (ruleId) {
    const { error } = await admin
      .from("org_compliance_overrides")
      .delete()
      .eq("rule_id", ruleId)
      .eq("organization_id", ctx.orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or rule_id is required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
