/**
 * MCP tools for the inbound mailbox (rhodes-inbound-v1-build-plan.md).
 * Chat parity for GET /api/inbound + POST /api/inbound/[id]/resolve, so the
 * agent can answer "did anything come in from my CPA?" and close out nudges.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";

export const listInboundDeliveriesTool = defineTool({
  name: "list_inbound_deliveries",
  description:
    "List emails received in Rhodes' inbound mailbox and what happened to each: " +
    "ingested (attachments filed automatically, with document ids), needs_user " +
    "(a delivery Rhodes couldn't fetch — the user should forward or upload it), " +
    "failed, or ignored. Use to answer 'did anything arrive from my accountant' " +
    "or 'what came in this week'.",
  kind: "read",
  inputSchema: z.object({
    status: z
      .enum(["needs_user", "acknowledged", "ingested", "retrieved", "failed", "ignored", "resolved", "dismissed"])
      .optional()
      .describe("Filter to one disposition; omit for all non-ignored."),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: async ({ status, limit }, ctx) => {
    let q = ctx.supabase
      .from("inbound_deliveries")
      .select("id, sender, subject, received_at, classification, status, document_ids, needs_user_reason, error")
      .eq("organization_id", ctx.orgId)
      .order("received_at", { ascending: false })
      .limit(limit ?? 25);
    q = status ? q.eq("status", status) : q.neq("status", "ignored");
    const { data, error } = await q;
    if (error) throw error;
    return { data: { deliveries: data ?? [] } };
  },
});

export const resolveInboundDeliveryTool = defineTool({
  name: "resolve_inbound_delivery",
  description:
    "Update a needs_user/failed inbound delivery: 'acknowledged' = the user says they forwarded it (stops reminders, stays open until the document arrives), 'resolved' = the document made it in another way, 'dismissed' = not relevant.",
  kind: "write",
  inputSchema: z.object({
    delivery_id: z.string().uuid(),
    action: z.enum(["acknowledged", "resolved", "dismissed"]),
  }),
  dryRun: async ({ delivery_id, action }, ctx) => {
    const { data } = await ctx.supabase
      .from("inbound_deliveries")
      .select("id, sender, subject, status")
      .eq("organization_id", ctx.orgId)
      .eq("id", delivery_id)
      .maybeSingle();
    if (!data) throw new Error("Inbound delivery not found");
    return {
      summary: `Mark the inbound email from ${data.sender}${data.subject ? ` ("${data.subject}")` : ""} as ${action}`,
    };
  },
  handler: async ({ delivery_id, action }, ctx) => {
    const { data, error } = await ctx.supabase
      .from("inbound_deliveries")
      .update({ status: action, updated_at: new Date().toISOString() })
      .eq("organization_id", ctx.orgId)
      .eq("id", delivery_id)
      .in("status", ["needs_user", "acknowledged", "failed"])
      .select("id, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Inbound delivery not found or not in a resolvable state");
    return { data };
  },
});

export const inboundTools: ToolDefinition[] = [listInboundDeliveriesTool];
export const inboundWriteTools: ToolDefinition[] = [resolveInboundDeliveryTool];
