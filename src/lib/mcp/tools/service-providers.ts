/**
 * Service-provider read tools (Phase 1 routing hub).
 *
 * Both tools filter `deleted_at IS NULL` — soft-deleted providers must not
 * appear in tool results. Org scope is the hard gate on every query
 * (`ctx.orgId`, never from tool args). Mirrors directory.ts.
 *
 * `get_service_provider` additionally returns the linked entity ids so Claude
 * can answer "which entities does Andersen serve?" without further calls. The
 * shape mirrors GET `/api/service-providers/[id]`.
 */

import { z } from "zod";
import { defineTool, MAX_LIST_ROWS, type ToolDefinition } from "../schema";
import { getProviderSuggestions } from "@/lib/providers/suggestions";

// --- list_service_providers --------------------------------------------------

const listProvidersInput = z.object({
  name_query: z.string().optional().describe("Case-insensitive ILIKE match on provider name."),
  discipline: z.string().optional().describe("Filter to providers tagged with this discipline (e.g. 'tax', 'bookkeeping')."),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

export const listServiceProvidersTool = defineTool({
  name: "list_service_providers",
  description:
    "List service providers (CPA, bookkeeper, attorney, registered agent, etc.) in the user's organization. Excludes soft-deleted providers. Supports name search and discipline filter.",
  kind: "read",
  inputSchema: listProvidersInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;
    let query = ctx.supabase
      .from("service_providers")
      .select("id, name, disciplines, domains, default_contact_email, serves_all_entities, contacts")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .order("name")
      .limit(limit + 1);

    if (args.name_query) query = query.ilike("name", `%${args.name_query}%`);
    if (args.discipline) query = query.contains("disciplines", [args.discipline]);

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

// --- get_service_provider ----------------------------------------------------

const getProviderInput = z.object({
  provider_id: z.string().uuid(),
});

export const getServiceProviderTool = defineTool({
  name: "get_service_provider",
  description:
    "Fetch one service provider plus the ids of the entities it serves (or serves_all_entities=true for firms that touch everything). Useful for 'which entities does X serve' and resolving a recipient before a send.",
  kind: "read",
  inputSchema: getProviderInput,
  handler: async ({ provider_id }, ctx) => {
    const { data: provider, error } = await ctx.supabase
      .from("service_providers")
      .select("*")
      .eq("id", provider_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!provider) return { data: null };

    const [{ data: links, error: linkErr }, { data: routing }] = await Promise.all([
      ctx.supabase
        .from("service_provider_entities")
        .select("entity_id")
        .eq("organization_id", ctx.orgId)
        .eq("provider_id", provider_id),
      ctx.supabase
        .from("org_provider_routing_rules")
        .select("document_type, times_confirmed, last_sent_at")
        .eq("organization_id", ctx.orgId)
        .eq("provider_id", provider_id)
        .eq("is_active", true)
        .order("times_confirmed", { ascending: false }),
    ]);
    if (linkErr) throw linkErr;

    return {
      data: ctx.redact({
        ...provider,
        entity_ids: (links ?? []).map((l) => l.entity_id as string),
        learned_routing: routing ?? [],
      }),
    };
  },
});

// --- list_provider_sends -----------------------------------------------------

const listSendsInput = z.object({
  provider_id: z.string().uuid(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

export const listProviderSendsTool = defineTool({
  name: "list_provider_sends",
  description:
    "List the documents sent to a service provider (the send log) — document, recipient, status, and when. Use to answer 'what have we sent Andersen'.",
  kind: "read",
  inputSchema: listSendsInput,
  handler: async ({ provider_id, limit }, ctx) => {
    const lim = limit ?? 25;
    const { data: sends, error } = await ctx.supabase
      .from("provider_document_sends")
      .select("id, document_id, recipient_email, subject, status, delivery_provider, sent_at, created_at")
      .eq("organization_id", ctx.orgId)
      .eq("provider_id", provider_id)
      .order("created_at", { ascending: false })
      .limit(lim + 1);
    if (error) throw error;

    const rows = sends ?? [];
    const truncated = rows.length > lim;
    const page = truncated ? rows.slice(0, lim) : rows;

    // Join document names.
    const docIds = [...new Set(page.map((s) => s.document_id))];
    const nameById = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: docs } = await ctx.supabase
        .from("documents")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .in("id", docIds);
      for (const d of docs ?? []) nameById.set(d.id, d.name);
    }

    return {
      data: ctx.redact(page.map((s) => ({ ...s, document_name: nameById.get(s.document_id) ?? null }))),
      truncated,
    };
  },
});

// --- get_provider_suggestions ------------------------------------------------

const getSuggestionsInput = z.object({
  document_id: z.string().uuid(),
});

export const getProviderSuggestionsTool = defineTool({
  name: "get_provider_suggestions",
  description:
    "Given a document, suggest which service providers serve its entity — ranked by discipline relevance to the document type. Use before sending to pick the right provider + recipient. Read-only; never filters serving providers out.",
  kind: "read",
  inputSchema: getSuggestionsInput,
  handler: async ({ document_id }, ctx) => {
    const suggestions = await getProviderSuggestions(ctx.supabase, ctx.orgId, document_id);
    return { data: ctx.redact(suggestions) };
  },
});

export const serviceProviderTools: ToolDefinition[] = [
  listServiceProvidersTool,
  getServiceProviderTool,
  getProviderSuggestionsTool,
  listProviderSendsTool,
];
