import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyActions } from "@/lib/pipeline/apply";
import { createServiceProviderSchema } from "@/lib/validations";

// GET /api/service-providers — list providers with linked-entity counts/ids.
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = await createClient();

    const { data: providers, error } = await supabase
      .from("service_providers")
      .select("*")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("name");

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!providers || providers.length === 0) {
      return NextResponse.json([]);
    }

    const providerIds = providers.map((p) => p.id);
    const { data: links } = await supabase
      .from("service_provider_entities")
      .select("provider_id, entity_id")
      .eq("organization_id", orgId)
      .in("provider_id", providerIds);

    const byProvider: Record<string, string[]> = {};
    for (const link of links ?? []) {
      (byProvider[link.provider_id] ||= []).push(link.entity_id);
    }

    const enriched = providers.map((p) => ({
      ...p,
      entity_ids: byProvider[p.id] ?? [],
      entity_count: (byProvider[p.id] ?? []).length,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/service-providers error:", err);
    return NextResponse.json({ error: "Failed to fetch service providers" }, { status: 500 });
  }
}

// POST /api/service-providers — create a provider via the create_service_provider action.
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json();
    const parsed = createServiceProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { results } = await applyActions(
      [{ action: "create_service_provider", data: parsed.data }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to create" }, { status: 500 });
    }

    return NextResponse.json(r.data, { status: 201 });
  } catch (err) {
    console.error("POST /api/service-providers error:", err);
    return NextResponse.json({ error: "Failed to create service provider" }, { status: 500 });
  }
}
