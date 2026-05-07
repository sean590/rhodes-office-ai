/**
 * Entity-domain MCP tools: list_entities, get_entity, get_entity_members,
 * get_cap_table, get_entity_compliance, get_entity_relationships.
 *
 * `get_entity_filings` is deferred alongside the entity_filings table (see
 * master architecture spec Prerequisites).
 *
 * Invariants shared by every tool in this file:
 * - `organization_id` is taken from `ctx.orgId`, never from args.
 * - Entity-scoped child tables (members, cap_table, obligations) route
 *   through `verifyEntityBelongsToOrg` first — those tables have no
 *   organization_id column and would otherwise be reachable by id alone.
 * - All rows flow through `ctx.redact()` before return.
 * - List results cap at MAX_LIST_ROWS; exceeding sets `truncated: true`.
 */

import { z } from "zod";
import { defineTool, MAX_LIST_ROWS, type ToolDefinition } from "../schema";
import { verifyEntityBelongsToOrg, isoDateOffsetUtc } from "../tool-helpers";
import { logSensitiveReveal } from "../tool-call-log";

const listEntitiesInput = z.object({
  name_query: z
    .string()
    .optional()
    .describe("Case-insensitive partial name match (ILIKE '%query%')."),
  type: z
    .enum([
      "holding_company",
      "investment_fund",
      "operating_company",
      "real_estate",
      "special_purpose",
      "management_company",
      "trust",
      "person",
      "joint_title",
      "other",
    ])
    .optional(),
  status: z.enum(["active", "inactive", "dissolved"]).optional(),
  parent_entity_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

interface ListEntitiesRow {
  id: string;
  name: string;
  type: string;
  status: string;
  parent_entity_id: string | null;
  formation_state: string | null;
  formed_date: string | null;
}

export const listEntitiesTool = defineTool({
  name: "list_entities",
  description:
    "List entities in the user's organization. Returns id, name, type, status, and formation basics. Supports name search, type/status filter, and parent filter. Default limit 25, max 100. Use get_entity for full record of a specific row.",
  kind: "read",
  inputSchema: listEntitiesInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;

    let query = ctx.supabase
      .from("entities")
      .select("id, name, type, status, parent_entity_id, formation_state, formed_date")
      .eq("organization_id", ctx.orgId)
      .order("name")
      .limit(limit + 1);

    // Multi-token name match: split on whitespace and AND each token as a
    // separate ilike. This lets queries like "3680 Colonial" match
    // "3680 Colonial Dr LLC" as well as "Colonial 3680 LP" (word-order
    // independent). Single-substring ilike only worked when the user's
    // phrase appeared verbatim in the name — too strict for informal refs.
    if (args.name_query) {
      const tokens = args.name_query.split(/\s+/).filter((t) => t.length > 0);
      for (const t of tokens) {
        query = query.ilike("name", `%${t}%`);
      }
    }
    if (args.type) query = query.eq("type", args.type);
    if (args.status) query = query.eq("status", args.status);
    if (args.parent_entity_id) query = query.eq("parent_entity_id", args.parent_entity_id);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as ListEntitiesRow[];
    const truncated = rows.length > limit;
    const trimmed = truncated ? rows.slice(0, limit) : rows;

    return {
      data: ctx.redact(trimmed),
      truncated,
    };
  },
});

// --- get_entity --------------------------------------------------------------

const getEntityInput = z.object({
  entity_id: z.string().uuid(),
  reveal_sensitive: z.boolean().optional().default(false).describe(
    "If true, return unredacted EIN and tax_id. Every reveal is audited. Only use when the user explicitly asks for a sensitive value.",
  ),
});

export const getEntityTool = defineTool({
  name: "get_entity",
  description:
    "Fetch the full record for one entity, including trust_details when present, plus counts of related items (documents, members, managers, obligations, cap-table entries, relationships). Use after list_entities to zoom in. Accepts reveal_sensitive to unredact EIN/tax_id.",
  kind: "read",
  inputSchema: getEntityInput,
  handler: async ({ entity_id, reveal_sensitive }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);

    // Child tables carrying organization_id get the belt-and-suspenders
    // filter: documents and relationships. Tables without their own
    // organization_id column (trust_details, entity_members, entity_managers,
    // cap_table_entries, compliance_obligations) rely on the parent-ownership
    // gate above — documented in tool-helpers.ts.
    const [entityRes, trustRes, regsRes, stateIdsRes, countsDocs, countsMembers, countsManagers, countsCap, countsObligations, countsRelFrom, countsRelTo] =
      await Promise.all([
        ctx.supabase.from("entities").select("*").eq("id", entity_id).single(),
        ctx.supabase.from("trust_details").select("*").eq("entity_id", entity_id).maybeSingle(),
        ctx.supabase.from("entity_registrations").select("*").eq("entity_id", entity_id),
        ctx.supabase.from("entity_state_ids").select("*").eq("entity_id", entity_id),
        ctx.supabase.from("documents").select("id", { count: "exact", head: true }).eq("entity_id", entity_id).eq("organization_id", ctx.orgId).is("deleted_at", null),
        ctx.supabase.from("entity_members").select("id", { count: "exact", head: true }).eq("entity_id", entity_id),
        ctx.supabase.from("entity_managers").select("id", { count: "exact", head: true }).eq("entity_id", entity_id),
        ctx.supabase.from("cap_table_entries").select("id", { count: "exact", head: true }).eq("entity_id", entity_id),
        ctx.supabase.from("compliance_obligations").select("id", { count: "exact", head: true }).eq("entity_id", entity_id),
        ctx.supabase.from("relationships").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("from_entity_id", entity_id),
        ctx.supabase.from("relationships").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("to_entity_id", entity_id),
      ]);
    if (entityRes.error) throw entityRes.error;

    const record = {
      ...entityRes.data,
      trust_details: trustRes.data ?? null,
      registrations: regsRes.data ?? [],
      state_ids: stateIdsRes.data ?? [],
      counts: {
        documents: countsDocs.count ?? 0,
        members: countsMembers.count ?? 0,
        managers: countsManagers.count ?? 0,
        cap_table: countsCap.count ?? 0,
        obligations: countsObligations.count ?? 0,
        relationships: (countsRelFrom.count ?? 0) + (countsRelTo.count ?? 0),
      },
    };

    const revealFields = reveal_sensitive ? ["ein", "tax_id"] : [];
    if (reveal_sensitive) {
      await logSensitiveReveal(ctx, {
        tool_name: "get_entity",
        resource_type: "entity",
        resource_id: entity_id,
        fields_revealed: revealFields,
      });
    }
    return { data: ctx.redact(record, { reveal: revealFields }) };
  },
});

// --- get_entity_members ------------------------------------------------------

const entityIdInput = z.object({ entity_id: z.string().uuid() });

const entityMembersInput = z.object({
  entity_id: z.string().uuid(),
  reveal_sensitive: z.boolean().optional().default(false).describe(
    "If true, return unredacted SSN, date_of_birth, and home_address on members. Every reveal is audited.",
  ),
});

export const getEntityMembersTool = defineTool({
  name: "get_entity_members",
  description:
    "List the members and managers of one entity. Returns both roles as separate arrays so Claude can distinguish ownership from signing authority. Accepts reveal_sensitive to unredact SSN/date_of_birth/home_address.",
  kind: "read",
  inputSchema: entityMembersInput,
  handler: async ({ entity_id, reveal_sensitive }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);
    const [members, managers] = await Promise.all([
      ctx.supabase.from("entity_members").select("*").eq("entity_id", entity_id).order("name"),
      ctx.supabase.from("entity_managers").select("*").eq("entity_id", entity_id).order("name"),
    ]);
    if (members.error) throw members.error;
    if (managers.error) throw managers.error;
    const revealFields = reveal_sensitive ? ["ssn", "date_of_birth", "home_address"] : [];
    if (reveal_sensitive) {
      await logSensitiveReveal(ctx, {
        tool_name: "get_entity_members",
        resource_type: "entity",
        resource_id: entity_id,
        fields_revealed: revealFields,
      });
    }
    return {
      data: ctx.redact(
        { members: members.data ?? [], managers: managers.data ?? [] },
        { reveal: revealFields },
      ),
    };
  },
});

// --- get_cap_table -----------------------------------------------------------

export const getCapTableTool = defineTool({
  name: "get_cap_table",
  description:
    "Return the cap-table rows for one entity: investor name, type, units, ownership_pct, capital_contributed. Percentages sum to at most 100 (partial allocations allowed).",
  kind: "read",
  inputSchema: entityIdInput,
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);
    const { data, error } = await ctx.supabase
      .from("cap_table_entries")
      .select("*")
      .eq("entity_id", entity_id)
      .order("ownership_pct", { ascending: false });
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

// --- get_entity_compliance ---------------------------------------------------

const getEntityComplianceInput = z.object({
  entity_id: z.string().uuid(),
  include_completed: z.boolean().optional().default(false),
  days_ahead: z.number().int().min(1).max(730).optional(),
});

export const getEntityComplianceTool = defineTool({
  name: "get_entity_compliance",
  description:
    "List compliance obligations for one entity — upcoming and overdue by default; pass include_completed=true to include historical rows. Optional days_ahead caps the lookahead window.",
  kind: "read",
  inputSchema: getEntityComplianceInput,
  handler: async (args, ctx) => {
    await verifyEntityBelongsToOrg(ctx, args.entity_id);
    let query = ctx.supabase
      .from("compliance_obligations")
      .select("*")
      .eq("entity_id", args.entity_id)
      .order("next_due_date", { ascending: true });

    if (!args.include_completed) query = query.neq("status", "completed");
    if (args.days_ahead) {
      query = query.lte("next_due_date", isoDateOffsetUtc(args.days_ahead));
    }

    const { data, error } = await query;
    if (error) throw error;
    return { data: ctx.redact(data ?? []) };
  },
});

// --- get_entity_relationships -----------------------------------------------

export const getEntityRelationshipsTool = defineTool({
  name: "get_entity_relationships",
  description:
    "Return relationships where this entity appears on either side. Outbound (from_entity_id = entity) and inbound (to_entity_id = entity) returned as separate arrays.",
  kind: "read",
  inputSchema: entityIdInput,
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);
    const [outbound, inbound] = await Promise.all([
      ctx.supabase
        .from("relationships")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .eq("from_entity_id", entity_id)
        .order("created_at", { ascending: false }),
      ctx.supabase
        .from("relationships")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .eq("to_entity_id", entity_id)
        .order("created_at", { ascending: false }),
    ]);
    if (outbound.error) throw outbound.error;
    if (inbound.error) throw inbound.error;
    return {
      data: ctx.redact({
        outbound: outbound.data ?? [],
        inbound: inbound.data ?? [],
      }),
    };
  },
});

// --- get_entity_registrations -----------------------------------------------

export const getEntityRegistrationsTool = defineTool({
  name: "get_entity_registrations",
  description:
    "Fetch all registrations and state ID numbers for an entity. Returns jurisdictions where the entity is registered (formation + qualifications) merged with state-assigned entity/ID numbers.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);
    const [regsRes, stateIdsRes] = await Promise.all([
      ctx.supabase.from("entity_registrations").select("*").eq("entity_id", entity_id),
      ctx.supabase.from("entity_state_ids").select("*").eq("entity_id", entity_id),
    ]);

    const stateIdMap = new Map(
      ((stateIdsRes.data ?? []) as Array<Record<string, unknown>>).map((s) => [s.jurisdiction, s]),
    );
    const registrations = ((regsRes.data ?? []) as Array<Record<string, unknown>>).map((reg) => ({
      ...reg,
      state_id: stateIdMap.get(reg.jurisdiction as string) ?? null,
    }));

    const regJurisdictions = new Set(
      ((regsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => r.jurisdiction),
    );
    const orphanStateIds = ((stateIdsRes.data ?? []) as Array<Record<string, unknown>>).filter(
      (s) => !regJurisdictions.has(s.jurisdiction as string),
    );

    return {
      data: {
        registrations,
        orphan_state_ids: orphanStateIds,
      },
    };
  },
});

// --- get_trust_details -------------------------------------------------------

export const getTrustDetailsTool = defineTool({
  name: "get_trust_details",
  description:
    "Fetch trust-specific details (type, date, grantor, situs state, notes) and all trust roles " +
    "(trustees, beneficiaries, successor trustees, etc.) for an entity. Returns null trust_details if " +
    "the entity isn't a trust or trust_details haven't been recorded.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);

    const { data: trustDetails, error: tdErr } = await ctx.supabase
      .from("trust_details")
      .select("*")
      .eq("entity_id", entity_id)
      .maybeSingle();
    if (tdErr) throw tdErr;

    let trustRoles: unknown[] = [];
    if (trustDetails) {
      const { data, error } = await ctx.supabase
        .from("trust_roles")
        .select("*")
        .eq("trust_detail_id", (trustDetails as { id: string }).id)
        .order("role");
      if (error) throw error;
      trustRoles = data ?? [];
    }

    return {
      data: ctx.redact({
        trust_details: trustDetails ?? null,
        trust_roles: trustRoles,
      }),
    };
  },
});

// --- get_custom_fields -------------------------------------------------------

export const getCustomFieldsTool = defineTool({
  name: "get_custom_fields",
  description:
    "List custom field definitions and their values for an entity. Custom fields hold entity-specific " +
    "data outside the standard schema (fiscal year end, fund admin contact, tax ID format, etc.).",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);

    const [defs, values] = await Promise.all([
      ctx.supabase
        .from("custom_field_definitions")
        .select("id, label, field_type, options, is_global, sort_order")
        .or(`entity_id.eq.${entity_id},is_global.eq.true`)
        .order("sort_order"),
      ctx.supabase
        .from("custom_field_values")
        .select("field_def_id, value_text, value_boolean, value_date, value_number, updated_at")
        .eq("entity_id", entity_id),
    ]);
    if (defs.error) throw defs.error;
    if (values.error) throw values.error;

    const valueByDef = new Map<string, Record<string, unknown>>();
    for (const v of (values.data ?? []) as Array<Record<string, unknown>>) {
      valueByDef.set(v.field_def_id as string, v);
    }

    const merged = (defs.data ?? []).map((d: Record<string, unknown>) => {
      const v = valueByDef.get(d.id as string);
      return {
        id: d.id,
        label: d.label,
        field_type: d.field_type,
        options: d.options,
        is_global: d.is_global,
        value_text: v?.value_text ?? null,
        value_boolean: v?.value_boolean ?? null,
        value_date: v?.value_date ?? null,
        value_number: v?.value_number ?? null,
        updated_at: v?.updated_at ?? null,
      };
    });

    return { data: ctx.redact(merged) };
  },
});

// --- list_entity_people ------------------------------------------------------

export const listEntityPeopleTool = defineTool({
  name: "list_entity_people",
  description:
    "Merged list of everyone involved with an entity: members (owners), managers, trust roles " +
    "(trustees, beneficiaries, etc.), entity roles (general partner, tax matters partner, etc.), " +
    "and partnership representatives. Each row includes a `role_category` field so Claude can tell " +
    "what kind of involvement each person has. Use this to answer 'who is involved with X?' in one call.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async ({ entity_id }, ctx) => {
    await verifyEntityBelongsToOrg(ctx, entity_id);

    // Look up trust_detail_id (if the entity is a trust) so we can include roles.
    const { data: td } = await ctx.supabase
      .from("trust_details")
      .select("id")
      .eq("entity_id", entity_id)
      .maybeSingle();
    const trustDetailId = (td as { id?: string } | null)?.id ?? null;

    const [members, managers, entityRoles, trustRolesRes, partnershipReps] = await Promise.all([
      ctx.supabase.from("entity_members").select("id, name, directory_entry_id, ref_entity_id, created_at").eq("entity_id", entity_id).order("name"),
      ctx.supabase.from("entity_managers").select("id, name, directory_entry_id, ref_entity_id, created_at").eq("entity_id", entity_id).order("name"),
      ctx.supabase.from("entity_roles").select("id, role_title, name, directory_entry_id, ref_entity_id, created_at").eq("entity_id", entity_id).order("role_title"),
      trustDetailId
        ? ctx.supabase.from("trust_roles").select("id, role, name, directory_entry_id, ref_entity_id, effective_date, notes, created_at").eq("trust_detail_id", trustDetailId).order("role")
        : Promise.resolve({ data: [] as unknown[], error: null }),
      ctx.supabase.from("entity_partnership_reps").select("id, name, directory_entry_id, created_at").eq("entity_id", entity_id).order("name"),
    ]);
    for (const r of [members, managers, entityRoles, trustRolesRes, partnershipReps]) {
      if ((r as { error: unknown }).error) throw (r as { error: unknown }).error;
    }

    type Person = {
      id: string;
      name: string;
      role_category: "member" | "manager" | "entity_role" | "trust_role" | "partnership_rep";
      role_title: string | null;
      directory_entry_id: string | null;
      ref_entity_id: string | null;
      [k: string]: unknown;
    };

    const people: Person[] = [
      ...((members.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        name: m.name as string,
        role_category: "member" as const,
        role_title: null,
        directory_entry_id: (m.directory_entry_id as string) ?? null,
        ref_entity_id: (m.ref_entity_id as string) ?? null,
        created_at: m.created_at,
      })),
      ...((managers.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        name: m.name as string,
        role_category: "manager" as const,
        role_title: null,
        directory_entry_id: (m.directory_entry_id as string) ?? null,
        ref_entity_id: (m.ref_entity_id as string) ?? null,
        created_at: m.created_at,
      })),
      ...((entityRoles.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        role_category: "entity_role" as const,
        role_title: (r.role_title as string) ?? null,
        directory_entry_id: (r.directory_entry_id as string) ?? null,
        ref_entity_id: (r.ref_entity_id as string) ?? null,
        created_at: r.created_at,
      })),
      ...((trustRolesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        role_category: "trust_role" as const,
        role_title: (r.role as string) ?? null,
        directory_entry_id: (r.directory_entry_id as string) ?? null,
        ref_entity_id: (r.ref_entity_id as string) ?? null,
        effective_date: r.effective_date,
        notes: r.notes,
        created_at: r.created_at,
      })),
      ...((partnershipReps.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        role_category: "partnership_rep" as const,
        role_title: null,
        directory_entry_id: (r.directory_entry_id as string) ?? null,
        ref_entity_id: null,
        created_at: r.created_at,
      })),
    ];

    return { data: ctx.redact(people) };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Sync / refresh tools
//
// These call utility functions directly (bypassing apply.ts) and write
// rows as a side effect — but they're modeled as read tools because they
// don't capture user-intended mutations: they reconcile existing state
// against rules and registrations. No dryRun preview / approval card
// makes sense for "regenerate from current settings". Audit events are
// logged from the handler so the activity log still records each run.
// ─────────────────────────────────────────────────────────────────────

import { logAuditEvent } from "@/lib/utils/audit";

export const syncEntityComplianceTool = defineTool({
  name: "sync_entity_compliance",
  description:
    "Regenerate compliance obligations for an entity from current rules, registrations, and org/profile " +
    "overrides. Completed and exempt obligations are preserved; stale pending obligations are removed. " +
    "Run after adding a registration, changing formation state, or when the user asks to refresh.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    await verifyEntityBelongsToOrg(ctx, input.entity_id);
    const { syncComplianceForEntity } = await import("@/lib/utils/compliance-sync");
    const result = await syncComplianceForEntity(input.entity_id, ctx.orgId);

    await logAuditEvent({
      userId: ctx.userId,
      action: "sync",
      resourceType: "compliance",
      resourceId: input.entity_id,
      entityId: input.entity_id,
      organizationId: ctx.orgId,
      metadata: result as unknown as Record<string, unknown>,
    });

    return { data: result };
  },
});

export const refreshDocumentExpectationsTool = defineTool({
  name: "refresh_document_expectations",
  description:
    "Regenerate an entity's document checklist from current org overrides and entity-type profiles, " +
    "then re-check satisfaction against existing documents. Manual expectations, dismissed items, and " +
    "satisfied items are preserved. Run after changing document profiles, an entity's legal structure, " +
    "or when the user asks to refresh.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    await verifyEntityBelongsToOrg(ctx, input.entity_id);
    // Same two-step the API route's "refresh" action runs: regenerate from
    // profiles + overrides, then sweep documents to re-mark satisfaction.
    const { refreshEntityExpectations, recheckEntityExpectations } = await import(
      "@/lib/utils/document-expectations"
    );
    await refreshEntityExpectations(input.entity_id);
    await recheckEntityExpectations(input.entity_id);

    await logAuditEvent({
      userId: ctx.userId,
      action: "refresh",
      resourceType: "document_expectation",
      resourceId: input.entity_id,
      entityId: input.entity_id,
      organizationId: ctx.orgId,
    });

    return { data: { entity_id: input.entity_id } };
  },
});

export const syncEntityMembersTool = defineTool({
  name: "sync_entity_members",
  description:
    "Reconcile an entity's members with its cap table: create directory entries for unmatched names, " +
    "link members and cap-table rows to directory entries, and insert missing rows on either side. " +
    "Useful after bulk document processing created one side but not the other. Returns counts for each pass.",
  kind: "read",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  handler: async (input, ctx) => {
    await verifyEntityBelongsToOrg(ctx, input.entity_id);
    const { syncEntityMembers } = await import("@/lib/utils/sync-members");
    const result = await syncEntityMembers(input.entity_id, ctx.orgId);

    await logAuditEvent({
      userId: ctx.userId,
      action: "sync",
      resourceType: "entity_member",
      resourceId: input.entity_id,
      entityId: input.entity_id,
      organizationId: ctx.orgId,
      metadata: result as unknown as Record<string, unknown>,
    });

    return { data: result };
  },
});

export const entityTools: ToolDefinition[] = [
  listEntitiesTool,
  getEntityTool,
  getEntityMembersTool,
  getCapTableTool,
  getEntityComplianceTool,
  getEntityRelationshipsTool,
  getEntityRegistrationsTool,
  getTrustDetailsTool,
  getCustomFieldsTool,
  listEntityPeopleTool,
  syncEntityComplianceTool,
  refreshDocumentExpectationsTool,
  syncEntityMembersTool,
];
