import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = await createClient();

    // Fetch directory entries and entities in parallel
    const [directoryResult, entitiesResult] = await Promise.all([
      supabase
        .from("directory_entries")
        .select("id, name, type")
        .eq("organization_id", orgId)
        .order("name"),
      supabase
        .from("entities")
        .select("id, name, type")
        .eq("organization_id", orgId)
        .order("name"),
    ]);

    if (directoryResult.error) {
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    if (entitiesResult.error) {
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    // Map directory entries to picklist format
    const directoryItems = (directoryResult.data || []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      source: "directory" as const,
      source_type: entry.type,
    }));

    // Map entities to picklist format
    const entityItems = (entitiesResult.data || []).map((entity) => ({
      id: entity.id,
      name: entity.name,
      source: "entity" as const,
      source_type: entity.type,
    }));

    // Combine and sort by name (case-insensitive)
    const combined = [...directoryItems, ...entityItems].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    return NextResponse.json(combined);
  } catch (err) {
    console.error("GET /api/directory/picklist error:", err);
    return NextResponse.json(
      { error: "Failed to fetch picklist items" },
      { status: 500 }
    );
  }
}
