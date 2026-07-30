/**
 * MCP tools for the inbound mailbox (rhodes-inbound-v1-build-plan.md).
 * Chat parity for GET /api/inbound + POST /api/inbound/[id]/resolve (so the
 * agent can answer "did anything come in from my CPA?" and close out nudges)
 * and the /api/inbound/provider-suggestions discovery trio (spec §1c).
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import {
  listProviderSuggestions,
  acceptProviderSuggestion,
  dismissProviderSuggestion,
  suggestNameFromDomain,
} from "@/lib/inbound/provider-discovery";

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

const domainArg = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain")
  .describe("Sender email domain, e.g. 'bpwcpa.com'.");

export const listProviderSuggestionsTool = defineTool({
  name: "list_provider_suggestions",
  description:
    "List email domains that repeatedly sent document deliveries but aren't a " +
    "service provider yet ('Add {Firm} as a provider?' suggestions). Each has " +
    "the domain, delivery count, latest subject, and a suggested firm name.",
  kind: "read",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const suggestions = await listProviderSuggestions(ctx.supabase, ctx.orgId);
    return { data: { suggestions } };
  },
});

export const acceptProviderSuggestionTool = defineTool({
  name: "accept_provider_suggestion",
  description:
    "Add a discovered sender domain as a service provider: creates the provider " +
    "(name + domain; details editable in People) and retroactively attributes " +
    "that domain's past inbound emails to it.",
  kind: "write",
  inputSchema: z.object({
    domain: domainArg,
    name: z.string().min(1).max(255).optional()
      .describe("Provider name; defaults to a cleaned-up form of the domain."),
  }),
  dryRun: async ({ domain, name }) => ({
    summary: `Add ${name?.trim() || suggestNameFromDomain(domain)} (${domain.toLowerCase()}) as a service provider and attribute past emails from that domain`,
  }),
  handler: async ({ domain, name }, ctx) => {
    const result = await acceptProviderSuggestion(
      ctx.supabase, ctx.orgId, ctx.userId, domain,
      name?.trim() || suggestNameFromDomain(domain),
    );
    return { data: result };
  },
});

export const dismissProviderSuggestionTool = defineTool({
  name: "dismiss_provider_suggestion",
  description:
    "Mark a suggested sender domain as not a service provider — permanently " +
    "mutes 'Add as a provider?' suggestions for that domain.",
  kind: "write",
  inputSchema: z.object({ domain: domainArg }),
  dryRun: async ({ domain }) => ({
    summary: `Stop suggesting ${domain.toLowerCase()} as a provider`,
  }),
  handler: async ({ domain }, ctx) => {
    await dismissProviderSuggestion(ctx.supabase, ctx.orgId, domain);
    return { data: { ok: true, domain: domain.toLowerCase() } };
  },
});

export const inboundTools: ToolDefinition[] = [listInboundDeliveriesTool, listProviderSuggestionsTool];
export const inboundWriteTools: ToolDefinition[] = [
  resolveInboundDeliveryTool,
  acceptProviderSuggestionTool,
  dismissProviderSuggestionTool,
];
