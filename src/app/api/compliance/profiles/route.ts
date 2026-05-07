import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { COMPLIANCE_RULES } from "@/lib/data/compliance-rules";
import type { EntityTypeScope } from "@/lib/data/compliance-rules";

const VALID_SCOPES: EntityTypeScope[] = ["llc", "corporation", "lp", "trust", "person"];

export async function GET(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const url = new URL(request.url);
  const scope = url.searchParams.get("entity_type_scope");

  const admin = createAdminClient();
  let query = admin
    .from("compliance_profiles")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("entity_type_scope")
    .order("rule_id");

  if (scope && VALID_SCOPES.includes(scope as EntityTypeScope)) {
    query = query.eq("entity_type_scope", scope);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const body = await request.json();
  const { entity_type_scope, rule_id, enabled, notes } = body;

  if (!entity_type_scope || !VALID_SCOPES.includes(entity_type_scope)) {
    return NextResponse.json({ error: "valid entity_type_scope is required" }, { status: 400 });
  }
  if (!rule_id) return NextResponse.json({ error: "rule_id is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("compliance_profiles")
    .upsert(
      {
        organization_id: ctx.orgId,
        entity_type_scope,
        rule_id,
        enabled: enabled ?? true,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,entity_type_scope,rule_id" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** Seed profiles for a given entity type scope from the static rules engine. */
export async function PUT(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const body = await request.json();
  const { entity_type_scope } = body;

  if (!entity_type_scope || !VALID_SCOPES.includes(entity_type_scope)) {
    return NextResponse.json({ error: "valid entity_type_scope is required" }, { status: 400 });
  }

  const matchingRules = COMPLIANCE_RULES.filter((r) =>
    r.entity_types.includes("all") || r.entity_types.includes(entity_type_scope),
  );

  const admin = createAdminClient();

  const rows = matchingRules.map((r) => ({
    organization_id: ctx.orgId,
    entity_type_scope,
    rule_id: r.id,
    enabled: true,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) {
    return NextResponse.json({ seeded: 0 });
  }

  const { error } = await admin
    .from("compliance_profiles")
    .upsert(rows, { onConflict: "organization_id,entity_type_scope,rule_id", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ seeded: rows.length });
}
