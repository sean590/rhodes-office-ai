import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

/**
 * GET /api/expectations
 * Returns all unsatisfied expectations across all entities in the org,
 * grouped by entity. Used for the global "Missing" view.
 */
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("entity_document_expectations")
      .select("id, entity_id, document_type, document_category, is_required, is_satisfied, is_not_applicable, is_suggestion, source, notes")
      .eq("organization_id", orgId)
      .eq("is_satisfied", false)
      .eq("is_not_applicable", false)
      .eq("is_suggestion", false)
      .order("document_category")
      .order("document_type");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch entity names for grouping
    const entityIds = [...new Set((data || []).map((e: { entity_id: string }) => e.entity_id))];
    let entityNames: Record<string, string> = {};

    if (entityIds.length > 0) {
      const { data: entities } = await admin
        .from("entities")
        .select("id, name")
        .in("id", entityIds);

      for (const ent of entities || []) {
        entityNames[ent.id] = ent.name;
      }
    }

    // Group by entity
    const grouped: Record<string, { entity_name: string; missing: typeof data }> = {};
    for (const exp of data || []) {
      const eid = exp.entity_id as string;
      if (!grouped[eid]) {
        grouped[eid] = {
          entity_name: entityNames[eid] || "Unknown",
          missing: [],
        };
      }
      grouped[eid].missing.push(exp);
    }

    // Convert to sorted array
    const result = Object.entries(grouped)
      .map(([entity_id, { entity_name, missing }]) => ({
        entity_id,
        entity_name,
        missing_count: missing.length,
        missing,
      }))
      .sort((a, b) => b.missing_count - a.missing_count);

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/expectations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
