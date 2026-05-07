/**
 * Shared helpers for MCP tool handlers.
 *
 * ## The org-scope rule for child-table reads
 *
 * Two patterns enforce `ctx.orgId` across the tool surface. Which one a
 * handler uses depends entirely on whether the child table carries its own
 * `organization_id` column.
 *
 * **Belt-and-suspenders (default):** child tables that carry
 * `organization_id` get a second `.eq("organization_id", ctx.orgId)` filter
 * on every query, even after the parent-ownership gate has run. This is the
 * pattern Claude should copy when adding new tools. Tables in this bucket:
 *   - documents
 *   - relationships
 *   - investments, investment_investors, investment_co_investors,
 *     investment_allocations, investment_transactions
 *   - directory_entries, entities
 *
 * **Parent-gate-only (intentional exception):** child tables that inherit
 * their organization_id transitively via an entity_id FK. Those tables have
 * no own organization_id column, so the filter can't be applied — the hard
 * gate is `verifyEntityBelongsToOrg` on the parent entity, and that must run
 * before any read. Tables in this bucket:
 *   - entity_members, entity_managers
 *   - trust_details
 *   - compliance_obligations
 *   - cap_table_entries
 *
 * If a new migration adds `organization_id` to any of the parent-gate-only
 * tables, the corresponding tool handlers should be upgraded to the
 * belt-and-suspenders pattern. `tools-cross-org.test.ts` pins the count of
 * org-scoped queries per tool so a regression fails loudly.
 */

import type { ToolContext } from "./tool-context";

/**
 * Returns today's date in UTC as a YYYY-MM-DD string, suitable for comparison
 * against Postgres DATE columns. Use this everywhere a tool needs "today" —
 * raw `new Date().toISOString().slice(0,10)` is host-TZ dependent and quietly
 * produces off-by-one boundaries on non-UTC servers.
 */
export function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns today + N days in UTC as YYYY-MM-DD. Matches `todayIsoUtc` semantics. */
export function isoDateOffsetUtc(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

export class ToolError extends Error {
  constructor(
    public readonly code: "not_found" | "permission_denied" | "validation_failed" | "rate_limited",
    message: string,
  ) {
    super(message);
  }
}

/** Throws ToolError("not_found") if entity doesn't exist in the caller's org. */
export async function verifyEntityBelongsToOrg(
  ctx: ToolContext,
  entityId: string,
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("entities")
    .select("id")
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolError("not_found", `entity ${entityId} not found`);
}

/** Same guarantee, for investment-scoped tools. */
export async function verifyInvestmentBelongsToOrg(
  ctx: ToolContext,
  investmentId: string,
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("investments")
    .select("id")
    .eq("id", investmentId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolError("not_found", `investment ${investmentId} not found`);
}
