/**
 * Resolves UUIDs to human-readable names for use in dryRun summaries.
 *
 * Used exclusively in write-tool dryRun paths — preview-time, not
 * mutation-time, so the extra queries are acceptable. The approval card
 * shows these summaries to users; they must never contain raw UUIDs.
 */

import type { ToolContext } from "./tool-context";

type NameTable = {
  table: string;
  nameColumn: string;
  orgScoped?: boolean;
};

const TABLE_MAP: Record<string, NameTable> = {
  entity: { table: "entities", nameColumn: "name", orgScoped: true },
  investment: { table: "investments", nameColumn: "name", orgScoped: true },
  document: { table: "documents", nameColumn: "name", orgScoped: true },
  directory_entry: { table: "directory_entries", nameColumn: "name", orgScoped: true },
  investment_investor: { table: "investment_investors", nameColumn: "entity_id", orgScoped: true },
  investment_co_investor: { table: "investment_co_investors", nameColumn: "directory_entry_id", orgScoped: true },
  investment_transaction: { table: "investment_transactions", nameColumn: "transaction_type", orgScoped: true },
  compliance_obligation: { table: "compliance_obligations", nameColumn: "name" },
  relationship: { table: "relationships", nameColumn: "description", orgScoped: true },
  service_provider: { table: "service_providers", nameColumn: "name", orgScoped: true },
};

/**
 * Resolve a resource UUID to its display name. Returns the UUID truncated
 * if resolution fails — never throws.
 */
export async function resolveName(
  ctx: ToolContext,
  resourceType: string,
  id: string,
): Promise<string> {
  const spec = TABLE_MAP[resourceType];
  if (!spec) return id.slice(0, 8) + "…";

  try {
    let query = ctx.supabase
      .from(spec.table)
      .select("*")
      .eq("id", id);
    if (spec.orgScoped) query = query.eq("organization_id", ctx.orgId);
    const { data } = await query.maybeSingle();
    if (!data) return id.slice(0, 8) + "…";
    const val = (data as Record<string, unknown>)[spec.nameColumn];

    // For investment_investor, the "name" is actually entity_id — resolve one
    // level deeper to the entity name.
    if (resourceType === "investment_investor" && typeof val === "string") {
      return resolveName(ctx, "entity", val);
    }
    // For investment_co_investor, resolve directory_entry_id → name.
    if (resourceType === "investment_co_investor" && typeof val === "string") {
      return resolveName(ctx, "directory_entry", val);
    }

    return typeof val === "string" && val.length > 0 ? val : id.slice(0, 8) + "…";
  } catch {
    return id.slice(0, 8) + "…";
  }
}

/**
 * Batch-resolve multiple IDs. Convenience for summaries referencing several
 * resources.
 */
export async function resolveNames(
  ctx: ToolContext,
  items: Array<{ type: string; id: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    items.map(async ({ type, id }) => {
      map.set(id, await resolveName(ctx, type, id));
    }),
  );
  return map;
}
