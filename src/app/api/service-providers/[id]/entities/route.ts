import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { applyActions } from "@/lib/pipeline/apply";
import { linkProviderEntitySchema } from "@/lib/validations";

// Verify the provider exists and belongs to this org (the [id] segment).
async function providerInOrg(providerId: string, orgId: string): Promise<boolean> {
  const admin = createOrgClient(orgId);
  const { data } = await admin
    .from("service_providers")
    .select("id")
    .eq("id", providerId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

// POST /api/service-providers/[id]/entities — link an entity via link_provider_entity.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const body = await request.json();
    const parsed = linkProviderEntitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!(await providerInOrg(id, orgId))) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    if (!(await validateEntityOrg(parsed.data.entity_id, orgId))) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const { results } = await applyActions(
      [{ action: "link_provider_entity", data: { provider_id: id, entity_id: parsed.data.entity_id } }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to link" }, { status: 500 });
    }

    return NextResponse.json(r.data, { status: 201 });
  } catch (err) {
    console.error("POST /api/service-providers/[id]/entities error:", err);
    return NextResponse.json({ error: "Failed to link entity" }, { status: 500 });
  }
}

// DELETE /api/service-providers/[id]/entities — unlink an entity via unlink_provider_entity.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const body = await request.json();
    const parsed = linkProviderEntitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!(await providerInOrg(id, orgId))) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const { results } = await applyActions(
      [{ action: "unlink_provider_entity", data: { provider_id: id, entity_id: parsed.data.entity_id } }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to unlink" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/service-providers/[id]/entities error:", err);
    return NextResponse.json({ error: "Failed to unlink entity" }, { status: 500 });
  }
}
