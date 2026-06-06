/**
 * Generalized resource ownership verification for MCP write tools.
 *
 * Single entry point for all resource types. Verifies the resource exists AND
 * belongs to `ctx.orgId`. Returns silently on success; throws
 * `ToolError('not_found', ...)` on failure (no existence leak — 404 whether
 * the id is unknown or belongs to another org).
 *
 * Phase 1 shipped per-type helpers in `tool-helpers.ts`; those now re-export
 * through this module. They're kept as thin re-exports so existing call sites
 * and tests don't break; delete them after one release cycle.
 *
 * ## Org-scope rule (from tool-helpers.ts header)
 *
 * Tables that carry `organization_id` get a belt-and-suspenders
 * `.eq("organization_id", ctx.orgId)` filter. Tables that inherit org scope
 * transitively via an entity FK (entity_members, entity_managers,
 * trust_details, compliance_obligations, cap_table_entries) first resolve
 * their parent entity_id, then verify the parent entity's org ownership.
 */

import type { ToolContext } from "./tool-context";
import { ToolError } from "./tool-helpers";

export type ResourceType =
  | "entity"
  | "investment"
  | "investment_investor"
  | "investment_co_investor"
  | "investment_transaction"
  | "investment_allocation"
  | "directory_entry"
  | "document"
  | "compliance_obligation"
  | "cap_table_entry"
  | "relationship"
  | "entity_member"
  | "entity_manager"
  | "entity_registration"
  | "trust_role"
  | "service_provider"
  | "provider_document_send";

// Tables with their own organization_id column → direct lookup.
const DIRECT_ORG_TABLES: Record<string, string> = {
  entity: "entities",
  investment: "investments",
  investment_investor: "investment_investors",
  investment_co_investor: "investment_co_investors",
  investment_transaction: "investment_transactions",
  investment_allocation: "investment_allocations",
  directory_entry: "directory_entries",
  document: "documents",
  relationship: "relationships",
  service_provider: "service_providers",
  provider_document_send: "provider_document_sends",
};

// Tables without organization_id — resolve parent entity_id, then verify entity.
const ENTITY_SCOPED: Record<string, { table: string; fk: string }> = {
  compliance_obligation: { table: "compliance_obligations", fk: "entity_id" },
  cap_table_entry: { table: "cap_table_entries", fk: "entity_id" },
  entity_member: { table: "entity_members", fk: "entity_id" },
  entity_manager: { table: "entity_managers", fk: "entity_id" },
  entity_registration: { table: "entity_registrations", fk: "entity_id" },
  trust_role: { table: "trust_roles", fk: "entity_id" },
};

export async function verifyResourceOwnership(
  ctx: ToolContext,
  opts: { resourceType: ResourceType; resourceId: string },
): Promise<void> {
  const { resourceType, resourceId } = opts;

  // Path 1: table has its own organization_id → single filtered lookup.
  const directTable = DIRECT_ORG_TABLES[resourceType];
  if (directTable) {
    const { data, error } = await ctx.supabase
      .from(directTable)
      .select("id")
      .eq("id", resourceId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ToolError("not_found", `${resourceType} ${resourceId} not found`);
    return;
  }

  // Path 2: entity-scoped child table → resolve parent entity_id, then
  // verify entity belongs to org. Two queries, but the child table doesn't
  // carry organization_id.
  const entityScoped = ENTITY_SCOPED[resourceType];
  if (entityScoped) {
    const { data: child, error: childErr } = await ctx.supabase
      .from(entityScoped.table)
      .select("*")
      .eq("id", resourceId)
      .maybeSingle();
    if (childErr) throw childErr;
    if (!child) throw new ToolError("not_found", `${resourceType} ${resourceId} not found`);
    const parentEntityId = (child as Record<string, unknown>)[entityScoped.fk] as string;
    if (!parentEntityId) {
      throw new ToolError("not_found", `${resourceType} ${resourceId} has no parent entity`);
    }
    // Verify the parent entity belongs to this org.
    const { data: entity, error: entityErr } = await ctx.supabase
      .from("entities")
      .select("id")
      .eq("id", parentEntityId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (entityErr) throw entityErr;
    if (!entity) throw new ToolError("not_found", `${resourceType} ${resourceId} not found`);
    return;
  }

  throw new ToolError("validation_failed", `unsupported resource type: ${resourceType}`);
}
