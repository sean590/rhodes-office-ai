import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyActions } from "@/lib/pipeline/apply";
import { updateServiceProviderSchema } from "@/lib/validations";

// GET /api/service-providers/[id] — fetch one provider with linked entity ids.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const { id } = await params;

    const supabase = await createClient();

    const { data: provider, error } = await supabase
      .from("service_providers")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!provider) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [{ data: links }, { data: routing }] = await Promise.all([
      supabase
        .from("service_provider_entities")
        .select("entity_id")
        .eq("organization_id", orgId)
        .eq("provider_id", id),
      supabase
        .from("org_provider_routing_rules")
        .select("document_type, times_confirmed, last_sent_at")
        .eq("organization_id", orgId)
        .eq("provider_id", id)
        .eq("is_active", true)
        .order("times_confirmed", { ascending: false }),
    ]);

    return NextResponse.json({
      ...provider,
      entity_ids: (links ?? []).map((l) => l.entity_id),
      // What Rhodes has learned to route here (read-only transparency).
      learned_routing: routing ?? [],
    });
  } catch (err) {
    console.error("GET /api/service-providers/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch service provider" }, { status: 500 });
  }
}

// PUT /api/service-providers/[id] — update via the update_service_provider action.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const body = await request.json();
    const parsed = updateServiceProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { results } = await applyActions(
      [{ action: "update_service_provider", data: { ...parsed.data, provider_id: id } }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to update" }, { status: 500 });
    }

    return NextResponse.json(r.data);
  } catch (err) {
    console.error("PUT /api/service-providers/[id] error:", err);
    return NextResponse.json({ error: "Failed to update service provider" }, { status: 500 });
  }
}

// DELETE /api/service-providers/[id] — soft-delete via delete_service_provider action.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const { results } = await applyActions(
      [{ action: "delete_service_provider", data: { provider_id: id } }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to delete" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/service-providers/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete service provider" }, { status: 500 });
  }
}
