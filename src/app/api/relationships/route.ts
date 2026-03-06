import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { createRelationshipSchema } from "@/lib/validations";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = await createClient();

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    // Fetch relationships
    const { data: relationships, error } = await supabase
      .from("relationships")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!relationships || relationships.length === 0) {
      return NextResponse.json([]);
    }

    // Collect all unique entity IDs and directory IDs we need to resolve
    const entityIds = new Set<string>();
    const directoryIds = new Set<string>();

    for (const rel of relationships) {
      if (rel.from_entity_id) entityIds.add(rel.from_entity_id);
      if (rel.to_entity_id) entityIds.add(rel.to_entity_id);
      if (rel.from_directory_id) directoryIds.add(rel.from_directory_id);
      if (rel.to_directory_id) directoryIds.add(rel.to_directory_id);
    }

    // Fetch entity and directory names in parallel
    const [entitiesResult, directoryResult] = await Promise.all([
      entityIds.size > 0
        ? supabase
            .from("entities")
            .select("id, name")
            .in("id", Array.from(entityIds))
        : Promise.resolve({ data: [], error: null }),
      directoryIds.size > 0
        ? supabase
            .from("directory_entries")
            .select("id, name")
            .in("id", Array.from(directoryIds))
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Build lookup maps
    const entityNames: Record<string, string> = {};
    if (entitiesResult.data) {
      for (const e of entitiesResult.data) {
        entityNames[e.id] = e.name;
      }
    }

    const directoryNames: Record<string, string> = {};
    if (directoryResult.data) {
      for (const d of directoryResult.data) {
        directoryNames[d.id] = d.name;
      }
    }

    // Enrich relationships with resolved names
    const enriched = relationships.map((rel) => {
      let from_name = "Unknown";
      if (rel.from_entity_id && entityNames[rel.from_entity_id]) {
        from_name = entityNames[rel.from_entity_id];
      } else if (rel.from_directory_id && directoryNames[rel.from_directory_id]) {
        from_name = directoryNames[rel.from_directory_id];
      }

      let to_name = "Unknown";
      if (rel.to_entity_id && entityNames[rel.to_entity_id]) {
        to_name = entityNames[rel.to_entity_id];
      } else if (rel.to_directory_id && directoryNames[rel.to_directory_id]) {
        to_name = directoryNames[rel.to_directory_id];
      }

      return {
        ...rel,
        from_name,
        to_name,
      };
    });

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error("GET /api/relationships error:", err);
    return NextResponse.json(
      { error: "Failed to fetch relationships" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const supabase = createAdminClient();
    const body = await request.json();

    const parsed = createRelationshipSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const {
      type,
      description,
      terms,
      from_entity_id,
      from_directory_id,
      to_entity_id,
      to_directory_id,
      frequency,
      status,
      effective_date,
      annual_estimate,
      document_ref,
      notes,
    } = parsed.data;

    // Must have at least one "from" and one "to" party
    if (!from_entity_id && !from_directory_id) {
      return NextResponse.json(
        { error: "A 'from' party is required (entity or directory entry)" },
        { status: 400 }
      );
    }

    if (!to_entity_id && !to_directory_id) {
      return NextResponse.json(
        { error: "A 'to' party is required (entity or directory entry)" },
        { status: 400 }
      );
    }

    const insert: Record<string, unknown> = {
      organization_id: orgId,
      type,
      description: description || null,
      terms: terms || null,
      from_entity_id: from_entity_id || null,
      from_directory_id: from_directory_id || null,
      to_entity_id: to_entity_id || null,
      to_directory_id: to_directory_id || null,
      frequency: frequency || null,
      status: status || "active",
      effective_date: effective_date || null,
      annual_estimate: annual_estimate ?? null,
      document_ref: document_ref || null,
      notes: notes || null,
    };

    const { data, error } = await supabase
      .from("relationships")
      .insert(insert)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "relationship",
      resourceId: data.id,
      metadata: {
        type,
        from_entity_id: from_entity_id || null,
        from_directory_id: from_directory_id || null,
        to_entity_id: to_entity_id || null,
        to_directory_id: to_directory_id || null,
      },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/relationships error:", err);
    return NextResponse.json(
      { error: "Failed to create relationship" },
      { status: 500 }
    );
  }
}
