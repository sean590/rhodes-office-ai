/**
 * Compliance-domain read tools.
 *
 * list_compliance_obligations — filterable cross-entity obligation rows.
 * list_document_expectations — per-entity document checklist (required,
 *   satisfied, missing, AI-suggested).
 * Complements get_compliance_summary (counts/rollups) with itemized data.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyEntityBelongsToOrg, todayIsoUtc } from "../tool-helpers";

const listComplianceInput = z.object({
  entity_id: z.string().uuid().optional(),
  entity_type: z.string().optional().describe("Filter by entity type (e.g. 'company', 'investment_fund', 'real_estate')"),
  legal_structure: z
    .enum(["llc", "corporation", "lp", "gp", "series_llc", "grantor_trust", "non_grantor_trust", "sole_prop", "other"])
    .optional()
    .describe("Filter by legal structure (e.g. 'llc' for all LLCs, 'corporation' for all C/S-corps)"),
  jurisdiction: z.string().optional().describe("e.g. DE, CA, federal"),
  obligation_type: z.string().optional().describe("e.g. franchise_tax, annual_report, ptet"),
  status: z.enum(["pending", "completed", "overdue"]).optional(),
  due_before: z.string().optional().describe("ISO date — obligations due on or before"),
  due_after: z.string().optional().describe("ISO date — obligations due on or after"),
  include_completed: z.boolean().optional().default(false),
});

export const listComplianceObligationsTool = defineTool({
  name: "list_compliance_obligations",
  description:
    "List compliance obligations across entities in the org. Filter by jurisdiction, obligation_type, status, due date range, specific entity, entity_type, or legal_structure. Use entity_type or legal_structure to answer type-level questions like 'what franchise tax obligations do my LLCs have?' in one call. Returns individual obligation rows with entity names.",
  kind: "read",
  inputSchema: listComplianceInput,
  handler: async (args, ctx) => {
    if (args.entity_id) await verifyEntityBelongsToOrg(ctx, args.entity_id);

    let entQuery = ctx.supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", ctx.orgId);
    if (args.entity_id) entQuery = entQuery.eq("id", args.entity_id);
    if (args.entity_type) entQuery = entQuery.eq("type", args.entity_type);
    if (args.legal_structure) entQuery = entQuery.eq("legal_structure", args.legal_structure);
    const { data: ents, error: entErr } = await entQuery;
    if (entErr) throw entErr;
    const entIds = (ents ?? []).map((e: { id: string }) => e.id);
    if (entIds.length === 0) return { data: [] };

    const entNameById = new Map(
      (ents as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
    );

    let query = ctx.supabase
      .from("compliance_obligations")
      .select(
        "id, entity_id, rule_id, jurisdiction, obligation_type, name, description, " +
        "frequency, next_due_date, status, completed_at, completed_by, document_id, " +
        "payment_amount, confirmation, notes, source",
      )
      .in("entity_id", entIds)
      .order("next_due_date", { ascending: true });

    if (args.jurisdiction) query = query.eq("jurisdiction", args.jurisdiction);
    if (args.obligation_type) query = query.eq("obligation_type", args.obligation_type);
    if (args.status === "completed") {
      query = query.eq("status", "completed");
    } else if (args.status === "pending") {
      query = query.eq("status", "pending");
    } else if (args.status === "overdue") {
      query = query.eq("status", "pending").lt("next_due_date", todayIsoUtc());
    }
    if (!args.include_completed && args.status !== "completed") {
      query = query.neq("status", "completed");
    }
    if (args.due_before) query = query.lte("next_due_date", args.due_before);
    if (args.due_after) query = query.gte("next_due_date", args.due_after);

    const { data: rows, error } = await query;
    if (error) throw error;

    return {
      data: ctx.redact(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rows ?? []).map((r: any) => ({
          ...r,
          entity_name: entNameById.get(r.entity_id as string) ?? null,
        })),
      ),
    };
  },
});

// ───────────────────────────────────────────────────────────────────
// list_document_expectations
// ───────────────────────────────────────────────────────────────────

const listDocumentExpectationsInput = z.object({
  entity_id: z.string().uuid(),
  status: z
    .enum(["all", "missing", "satisfied", "suggested"])
    .optional()
    .default("all")
    .describe(
      "Filter: 'missing' = unsatisfied required/optional, 'satisfied' = has linked doc, " +
      "'suggested' = inferred by AI, 'all' = everything",
    ),
  include_suggestions: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include AI-inferred suggestions (is_suggestion=true). Default true."),
});

export const listDocumentExpectationsTool = defineTool({
  name: "list_document_expectations",
  description:
    "List document expectations for an entity — what documents are required, which are satisfied, " +
    "which are missing, and any AI-suggested documents based on org patterns. " +
    "Use this to answer questions like 'what documents am I missing for [entity]?' or " +
    "'what documents does [entity] need?'",
  kind: "read",
  inputSchema: listDocumentExpectationsInput,
  handler: async (args, ctx) => {
    await verifyEntityBelongsToOrg(ctx, args.entity_id);

    let query = ctx.supabase
      .from("entity_document_expectations")
      .select(
        "id, entity_id, document_type, document_category, is_required, is_satisfied, " +
        "satisfied_by, is_suggestion, source, confidence, inference_reason, notes, " +
        "created_at, updated_at",
      )
      .eq("entity_id", args.entity_id)
      .eq("is_not_applicable", false)
      .order("is_required", { ascending: false })
      .order("document_type");

    if (!args.include_suggestions) {
      query = query.eq("is_suggestion", false);
    }

    if (args.status === "missing") {
      query = query.eq("is_satisfied", false).eq("is_suggestion", false);
    } else if (args.status === "satisfied") {
      query = query.eq("is_satisfied", true);
    } else if (args.status === "suggested") {
      query = query.eq("is_suggestion", true);
    }

    const { data, error } = await query;
    if (error) throw error;

    interface ExpectationRow {
      id: string;
      entity_id: string;
      document_type: string;
      document_category: string;
      is_required: boolean;
      is_satisfied: boolean;
      satisfied_by: string | null;
      is_suggestion: boolean;
      source: string;
      confidence: number | null;
      inference_reason: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }

    const rows = (data ?? []) as unknown as ExpectationRow[];

    // Enrich satisfied_by with the linked document's name.
    const docIds = Array.from(
      new Set(
        rows
          .map((e) => e.satisfied_by)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let docNames = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: docs } = await ctx.supabase
        .from("documents")
        .select("id, name")
        .in("id", docIds);
      docNames = new Map(
        (docs ?? []).map((d: { id: string; name: string }) => [d.id, d.name]),
      );
    }

    const enriched = rows.map((e) => ({
      ...e,
      satisfied_by_name: e.satisfied_by ? docNames.get(e.satisfied_by) ?? null : null,
    }));

    const summary = {
      total: enriched.length,
      satisfied: enriched.filter((e) => e.is_satisfied).length,
      missing_required: enriched.filter(
        (e) => !e.is_satisfied && !e.is_suggestion && e.is_required,
      ).length,
      missing_optional: enriched.filter(
        (e) => !e.is_satisfied && !e.is_suggestion && !e.is_required,
      ).length,
      suggestions: enriched.filter((e) => e.is_suggestion).length,
    };

    return { data: ctx.redact(enriched), summary };
  },
});

// ───────────────────────────────────────────────────────────────────
// get_upcoming_deadlines
// ───────────────────────────────────────────────────────────────────

const upcomingDeadlinesInput = z.object({
  days_ahead: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .default(90)
    .describe("How far ahead to look for due dates. Default 90 days. Already-overdue obligations are always included."),
  entity_id: z.string().uuid().optional().describe("Restrict to one entity."),
  jurisdiction: z.string().optional().describe("Two-letter state code to filter by, e.g. 'DE'."),
});

export const getUpcomingDeadlinesTool = defineTool({
  name: "get_upcoming_deadlines",
  description:
    "List pending and overdue compliance obligations due within the next N days (default 90), sorted " +
    "by due date ascending. Overdue items are always included regardless of the date window. Use this " +
    "for 'what's coming up this quarter?' or 'what's overdue across my entities?' Returns obligation rows " +
    "with entity names attached.",
  kind: "read",
  inputSchema: upcomingDeadlinesInput,
  handler: async (args, ctx) => {
    if (args.entity_id) await verifyEntityBelongsToOrg(ctx, args.entity_id);

    let entQuery = ctx.supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", ctx.orgId);
    if (args.entity_id) entQuery = entQuery.eq("id", args.entity_id);
    const { data: ents, error: entErr } = await entQuery;
    if (entErr) throw entErr;
    const entIds = (ents ?? []).map((e: { id: string }) => e.id);
    if (entIds.length === 0) return { data: [] };

    const entNameById = new Map(
      (ents as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + args.days_ahead);
    const cutoffIso = cutoff.toISOString().split("T")[0];

    let query = ctx.supabase
      .from("compliance_obligations")
      .select(
        "id, entity_id, rule_id, jurisdiction, obligation_type, name, description, " +
        "frequency, next_due_date, status, payment_amount, notes",
      )
      .in("entity_id", entIds)
      .in("status", ["pending", "overdue"])
      .not("next_due_date", "is", null)
      .lte("next_due_date", cutoffIso)
      .order("next_due_date", { ascending: true });

    if (args.jurisdiction) query = query.eq("jurisdiction", args.jurisdiction);

    const { data: rows, error } = await query;
    if (error) throw error;

    return {
      data: ctx.redact(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rows ?? []).map((r: any) => ({
          ...r,
          entity_name: entNameById.get(r.entity_id as string) ?? null,
        })),
      ),
    };
  },
});

// ───────────────────────────────────────────────────────────────────
// list_compliance_rules
// ───────────────────────────────────────────────────────────────────

export const listComplianceRulesTool = defineTool({
  name: "list_compliance_rules",
  description:
    "List the compliance rules known to the engine — filter by jurisdiction or entity-type scope. " +
    "Use to answer questions like 'what rules apply to Delaware LLCs?' or 'what annual reports do I " +
    "need to track for corporations?' This returns rule definitions; use list_compliance_obligations " +
    "to see which rules have actually generated obligations for specific entities.",
  kind: "read",
  inputSchema: z.object({
    jurisdiction: z.string().optional().describe("2-letter state code to filter by, e.g. 'DE'."),
    entity_type_scope: z
      .enum(["llc", "corporation", "lp", "trust", "person"])
      .optional()
      .describe("Filter rules that apply to this scope. Rules with scope 'all' always match."),
  }),
  handler: async (args, ctx) => {
    const { COMPLIANCE_RULES } = await import("@/lib/data/compliance-rules");
    const rules = COMPLIANCE_RULES.filter((r) => {
      if (args.jurisdiction && r.jurisdiction !== args.jurisdiction) return false;
      if (args.entity_type_scope) {
        if (!r.entity_types.includes("all") && !r.entity_types.includes(args.entity_type_scope)) return false;
      }
      return true;
    }).map((r) => ({
      id: r.id,
      jurisdiction: r.jurisdiction,
      entity_types: r.entity_types,
      obligation_type: r.obligation_type,
      name: r.name,
      description: r.description,
      frequency: r.frequency,
      filed_with: r.filed_with,
    }));
    return { data: ctx.redact(rules) };
  },
});

// ───────────────────────────────────────────────────────────────────
// list_compliance_profiles
// ───────────────────────────────────────────────────────────────────

export const listComplianceProfilesTool = defineTool({
  name: "list_compliance_profiles",
  description:
    "List the org's per-entity-type compliance profiles — each row says whether a specific rule is " +
    "enabled for a specific entity type. Use to answer 'what compliance profiles are enabled for " +
    "trusts?' or to diagnose why a rule isn't generating obligations for an entity type.",
  kind: "read",
  inputSchema: z.object({
    entity_type_scope: z
      .enum(["llc", "corporation", "lp", "trust", "person"])
      .optional()
      .describe("Restrict to one scope. Omit to list all four scopes."),
  }),
  handler: async (args, ctx) => {
    let query = ctx.supabase
      .from("compliance_profiles")
      .select("id, entity_type_scope, rule_id, enabled, notes, updated_at")
      .eq("organization_id", ctx.orgId)
      .order("entity_type_scope")
      .order("rule_id");
    if (args.entity_type_scope) query = query.eq("entity_type_scope", args.entity_type_scope);
    const { data, error } = await query;
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

export const complianceTools: ToolDefinition[] = [
  listComplianceObligationsTool,
  listDocumentExpectationsTool,
  getUpcomingDeadlinesTool,
  listComplianceRulesTool,
  listComplianceProfilesTool,
];
