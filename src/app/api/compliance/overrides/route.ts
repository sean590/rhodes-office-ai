import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { requireSensitive } from "@/lib/utils/aal";

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const admin = createOrgClient(ctx.orgId);
  const { data, error } = await admin
    .from("org_compliance_overrides")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/compliance/overrides query:", error);
    return NextResponse.json({ error: "Failed to load overrides" }, { status: 500 });
  }
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

  const admin = createOrgClient(ctx.orgId);

  // Delete any existing override for this rule, then insert.
  await admin
    .from("org_compliance_overrides")
    .delete()
    .eq("rule_id", rule_id);

  const { data, error } = await admin
    .from("org_compliance_overrides")
    .insert({
      rule_id,
      action,
      reason: reason || null,
      created_by: ctx.user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("POST /api/compliance/overrides insert:", error);
    return NextResponse.json({ error: "Failed to save override" }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const ctx = await requireSensitive("records:delete");
  if (isError(ctx)) return ctx;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const ruleId = url.searchParams.get("rule_id");

  const admin = createOrgClient(ctx.orgId);

  if (id) {
    const { error } = await admin
      .from("org_compliance_overrides")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("DELETE /api/compliance/overrides by id:", error);
      return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
    }
  } else if (ruleId) {
    const { error } = await admin
      .from("org_compliance_overrides")
      .delete()
      .eq("rule_id", ruleId);
    if (error) {
      console.error("DELETE /api/compliance/overrides by rule_id:", error);
      return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: "id or rule_id is required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
