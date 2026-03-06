import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = await createClient();

    // Fetch all directory entries
    const { data: entries, error } = await supabase
      .from("directory_entries")
      .select("*")
      .eq("organization_id", orgId)
      .order("name");

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json([]);
    }

    const entryIds = entries.map((e) => e.id);

    // Fetch usage counts from all related tables in parallel
    const [
      membersResult,
      managersResult,
      trustRolesResult,
      capTableResult,
      relationshipsFromResult,
      relationshipsToResult,
    ] = await Promise.all([
      supabase
        .from("entity_members")
        .select("directory_entry_id")
        .in("directory_entry_id", entryIds),
      supabase
        .from("entity_managers")
        .select("directory_entry_id")
        .in("directory_entry_id", entryIds),
      supabase
        .from("trust_roles")
        .select("directory_entry_id")
        .in("directory_entry_id", entryIds),
      supabase
        .from("cap_table_entries")
        .select("investor_directory_id")
        .in("investor_directory_id", entryIds),
      supabase
        .from("relationships")
        .select("from_directory_id")
        .in("from_directory_id", entryIds),
      supabase
        .from("relationships")
        .select("to_directory_id")
        .in("to_directory_id", entryIds),
    ]);

    // Build count maps for each table
    const memberCounts = buildCountMap(
      membersResult.data,
      "directory_entry_id"
    );
    const managerCounts = buildCountMap(
      managersResult.data,
      "directory_entry_id"
    );
    const trustRoleCounts = buildCountMap(
      trustRolesResult.data,
      "directory_entry_id"
    );
    const capTableCounts = buildCountMap(
      capTableResult.data,
      "investor_directory_id"
    );
    const relFromCounts = buildCountMap(
      relationshipsFromResult.data,
      "from_directory_id"
    );
    const relToCounts = buildCountMap(
      relationshipsToResult.data,
      "to_directory_id"
    );

    // Combine counts into each entry
    const enrichedEntries = entries.map((entry) => {
      const entityCount =
        (memberCounts[entry.id] || 0) + (managerCounts[entry.id] || 0);
      const trustRoleCount = trustRoleCounts[entry.id] || 0;
      const capTableCount = capTableCounts[entry.id] || 0;
      const relationshipCount =
        (relFromCounts[entry.id] || 0) + (relToCounts[entry.id] || 0);

      const usageCount =
        entityCount + trustRoleCount + capTableCount + relationshipCount;

      // Build usage details string
      const parts: string[] = [];
      if (entityCount > 0) {
        parts.push(`${entityCount} ${entityCount === 1 ? "entity" : "entities"}`);
      }
      if (trustRoleCount > 0) {
        parts.push(
          `${trustRoleCount} trust ${trustRoleCount === 1 ? "role" : "roles"}`
        );
      }
      if (capTableCount > 0) {
        parts.push(
          `${capTableCount} cap ${capTableCount === 1 ? "table" : "tables"}`
        );
      }
      if (relationshipCount > 0) {
        parts.push(
          `${relationshipCount} ${relationshipCount === 1 ? "relationship" : "relationships"}`
        );
      }

      return {
        id: entry.id,
        name: entry.name,
        type: entry.type,
        email: entry.email,
        aliases: entry.aliases || [],
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        usage_count: usageCount,
        usage_details: parts.length > 0 ? parts.join(", ") : "Not used",
      };
    });

    return NextResponse.json(enrichedEntries);
  } catch (err) {
    console.error("GET /api/directory error:", err);
    return NextResponse.json(
      { error: "Failed to fetch directory entries" },
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

    const { name, type, email, aliases } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "Name and type are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("directory_entries")
      .insert({
        organization_id: orgId,
        name,
        type,
        email: email || null,
        aliases: Array.isArray(aliases) ? aliases.filter((a: string) => a.trim()) : [],
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "directory_entry",
      resourceId: data.id,
      metadata: { name },
      ...reqCtx,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/directory error:", err);
    return NextResponse.json(
      { error: "Failed to create directory entry" },
      { status: 500 }
    );
  }
}

/**
 * Builds a map of { [id]: count } from an array of rows,
 * counting occurrences of the specified key.
 */
function buildCountMap(
  rows: Record<string, string>[] | null,
  key: string
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!rows) return map;
  for (const row of rows) {
    const id = row[key];
    if (id) {
      map[id] = (map[id] || 0) + 1;
    }
  }
  return map;
}
