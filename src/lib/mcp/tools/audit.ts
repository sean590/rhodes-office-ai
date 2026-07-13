/**
 * Audit-domain MCP tools: search_audit_log, get_recent_activity.
 *
 * audit_log carries its own organization_id (migration 011), so every query
 * scopes by ctx.orgId directly — no parent-ownership gate needed.
 *
 * Both tools return metadata JSONB in full; sensitive-field redaction runs
 * over it via ctx.redact before the result is handed to the orchestrator, so
 * any `ssn`/`ein`/etc. accidentally captured in a before/after payload is
 * scrubbed before reaching Claude.
 */

import { z } from "zod";
import {
  defineTool,
  MAX_LIST_ROWS,
  MAX_SEARCH_ROWS,
  type ToolDefinition,
} from "../schema";
import { verifyEntityBelongsToOrg, verifyInvestmentBelongsToOrg } from "../tool-helpers";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const auditSummaryColumns =
  "id, user_id, action, resource_type, resource_id, entity_id, investment_id, metadata, created_at";

// --- search_audit_log --------------------------------------------------------

const searchAuditLogInput = z.object({
  resource_type: z
    .string()
    .optional()
    .describe("e.g. 'entity', 'investment', 'document', 'investment_investor'."),
  resource_id: z.string().uuid().optional(),
  action: z
    .string()
    .optional()
    .describe("e.g. 'create', 'update', 'archive', 'delete', 'reactivate'."),
  entity_id: z.string().uuid().optional(),
  investment_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_ROWS).optional().default(25),
});

export const searchAuditLogTool = defineTool({
  name: "search_audit_log",
  description:
    "Search the audit log, scoped to the user's organization. Supports filters by resource_type, resource_id, action, entity_id, investment_id, user_id, and date range. Default limit 25, max 50.",
  kind: "read",
  inputSchema: searchAuditLogInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;
    let query = ctx.supabase
      .from("audit_log")
      .select(auditSummaryColumns)
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (args.resource_type) query = query.eq("resource_type", args.resource_type);
    if (args.resource_id) query = query.eq("resource_id", args.resource_id);
    if (args.action) query = query.eq("action", args.action);
    if (args.entity_id) query = query.eq("entity_id", args.entity_id);
    if (args.investment_id) query = query.eq("investment_id", args.investment_id);
    if (args.user_id) query = query.eq("user_id", args.user_id);
    if (args.date_from) query = query.gte("created_at", args.date_from);
    if (args.date_to) query = query.lte("created_at", args.date_to);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > limit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, limit) : rows),
      truncated,
    };
  },
});

// --- get_recent_activity -----------------------------------------------------

const recentActivityScope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity"), id: z.string().uuid() }),
  z.object({ type: z.literal("investment"), id: z.string().uuid() }),
  z.object({ type: z.literal("organization") }),
]);

const getRecentActivityInput = z.object({
  scope: recentActivityScope.optional().default({ type: "organization" }),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

export const getRecentActivityTool = defineTool({
  name: "get_recent_activity",
  description:
    "Most recent audit-log events. Default scope is organization-wide; pass scope={type:'entity'|'investment', id} to narrow. Default limit 25.",
  kind: "read",
  inputSchema: getRecentActivityInput,
  handler: async (args, ctx) => {
    if (args.scope.type === "entity") {
      await verifyEntityBelongsToOrg(ctx, args.scope.id);
    } else if (args.scope.type === "investment") {
      await verifyInvestmentBelongsToOrg(ctx, args.scope.id);
    }

    const limit = args.limit ?? 25;
    let query = ctx.supabase
      .from("audit_log")
      .select(auditSummaryColumns)
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (args.scope.type === "entity") query = query.eq("entity_id", args.scope.id);
    if (args.scope.type === "investment") query = query.eq("investment_id", args.scope.id);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > limit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, limit) : rows),
      truncated,
    };
  },
});

export const auditTools: ToolDefinition[] = [searchAuditLogTool, getRecentActivityTool];
