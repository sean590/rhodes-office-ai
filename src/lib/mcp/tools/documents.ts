/**
 * Document-domain MCP tools.
 *
 * Every tool filters `deleted_at IS NULL`. There is no tsvector column on
 * documents today, so search is ILIKE on `name` — upgrade to full-text when
 * migration-adjacent schema work lands.
 *
 * Document extraction JSON (`ai_extraction`) and text blobs can be large.
 * Tools only return the lighter-weight columns by default; full payloads come
 * via `get_document` so list operations stay compact.
 */

import { z } from "zod";
import {
  defineTool,
  MAX_LIST_ROWS,
  MAX_SEARCH_ROWS,
  type ToolDefinition,
} from "../schema";
import {
  verifyEntityBelongsToOrg,
  verifyInvestmentBelongsToOrg,
} from "../tool-helpers";

const documentSummaryColumns =
  "id, name, document_type, document_category, year, jurisdiction, entity_id, investment_id, created_at, ai_extracted";

// --- search_documents --------------------------------------------------------

const searchDocumentsInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("Case-insensitive partial match against document name."),
  entity_id: z.string().uuid().optional(),
  investment_id: z.string().uuid().optional(),
  document_type: z.string().optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("ISO date — filters by created_at >= this date."),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_ROWS).optional().default(25),
});

export const searchDocumentsTool = defineTool({
  name: "search_documents",
  description:
    "Find documents by partial filename match, scoped to the user's organization. Supports entity, investment, type, year, and date-range filters. Returns summary columns only — call get_document for full extraction JSON and storage URL.",
  kind: "read",
  inputSchema: searchDocumentsInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;
    let query = ctx.supabase
      .from("documents")
      .select(documentSummaryColumns)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .ilike("name", `%${args.query}%`)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (args.entity_id) query = query.eq("entity_id", args.entity_id);
    if (args.investment_id) query = query.eq("investment_id", args.investment_id);
    if (args.document_type) query = query.eq("document_type", args.document_type);
    if (args.year) query = query.eq("year", args.year);
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

// --- get_document ------------------------------------------------------------

const getDocumentInput = z.object({
  document_id: z.string().uuid(),
});

export const getDocumentTool = defineTool({
  name: "get_document",
  description:
    "Fetch one document's full metadata + extraction JSON + storage path. Returns null if the document doesn't exist in the user's organization or has been archived.",
  kind: "read",
  inputSchema: getDocumentInput,
  handler: async ({ document_id }, ctx) => {
    const { data, error } = await ctx.supabase
      .from("documents")
      .select("*")
      .eq("id", document_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { data: null };
    const result = ctx.redact(data) as Record<string, unknown>;
    if (result.status === "processing") {
      result.pipeline_status =
        "processing — extraction not complete yet. Basic metadata is available but ai_extraction results are pending.";
    }
    return { data: result };
  },
});

// --- list_documents_for_entity -----------------------------------------------

const listDocumentsForEntityInput = z.object({
  entity_id: z.string().uuid(),
  document_type: z.string().optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(50),
});

export const listDocumentsForEntityTool = defineTool({
  name: "list_documents_for_entity",
  description:
    "List documents linked to one entity (via documents.entity_id). Supports type and year filters. Excludes archived documents.",
  kind: "read",
  inputSchema: listDocumentsForEntityInput,
  handler: async (args, ctx) => {
    await verifyEntityBelongsToOrg(ctx, args.entity_id);
    const limit = args.limit ?? 50;
    let query = ctx.supabase
      .from("documents")
      .select(documentSummaryColumns)
      .eq("organization_id", ctx.orgId)
      .eq("entity_id", args.entity_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (args.document_type) query = query.eq("document_type", args.document_type);
    if (args.year) query = query.eq("year", args.year);

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

// --- list_documents_for_investment -------------------------------------------

const listDocumentsForInvestmentInput = z.object({
  investment_id: z.string().uuid(),
  document_type: z.string().optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(50),
});

export const listDocumentsForInvestmentTool = defineTool({
  name: "list_documents_for_investment",
  description:
    "List documents linked to one investment (via documents.investment_id). Supports type and year filters. Excludes archived documents.",
  kind: "read",
  inputSchema: listDocumentsForInvestmentInput,
  handler: async (args, ctx) => {
    await verifyInvestmentBelongsToOrg(ctx, args.investment_id);
    const limit = args.limit ?? 50;
    let query = ctx.supabase
      .from("documents")
      .select(documentSummaryColumns)
      .eq("organization_id", ctx.orgId)
      .eq("investment_id", args.investment_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (args.document_type) query = query.eq("document_type", args.document_type);
    if (args.year) query = query.eq("year", args.year);

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

// --- list_document_profiles --------------------------------------------------

export const listDocumentProfilesTool = defineTool({
  name: "list_document_profiles",
  description:
    "List the org's per-entity-type document profiles — each row declares which documents are expected " +
    "for a given scope (LLC/Corporation/LP/Trust), whether required or optional, and whether enabled. " +
    "Use to answer 'what documents does Rhodes require for LLCs?' or 'is the operating agreement " +
    "requirement enabled for corporations?'",
  kind: "read",
  inputSchema: z.object({
    entity_type_scope: z
      .enum(["llc", "corporation", "lp", "trust"])
      .optional()
      .describe("Restrict to one scope. Omit to list all four."),
  }),
  handler: async (args, ctx) => {
    let query = ctx.supabase
      .from("document_profiles")
      .select(
        "id, entity_type_scope, document_type, document_category, enabled, is_required, notes, updated_at",
      )
      .eq("organization_id", ctx.orgId)
      .order("entity_type_scope")
      .order("document_type");
    if (args.entity_type_scope) query = query.eq("entity_type_scope", args.entity_type_scope);
    const { data, error } = await query;
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

// --- list_document_overrides -------------------------------------------------

export const listDocumentOverridesTool = defineTool({
  name: "list_document_overrides",
  description:
    "List org-wide document type overrides — rows where a specific document type has been disabled " +
    "across every entity in the org. Use to answer 'which document types are disabled?' or when " +
    "diagnosing why a document type isn't showing up on checklists.",
  kind: "read",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.supabase
      .from("org_document_overrides")
      .select("id, document_type, action, reason, created_at")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

export const documentTools: ToolDefinition[] = [
  searchDocumentsTool,
  getDocumentTool,
  listDocumentsForEntityTool,
  listDocumentsForInvestmentTool,
  listDocumentProfilesTool,
  listDocumentOverridesTool,
];
