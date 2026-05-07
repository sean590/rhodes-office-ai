/**
 * Entity-domain write tools wrapping apply.ts handlers.
 *
 * create_entity, update_entity, archive_entity,
 * add_entity_member, update_entity_member, remove_entity_member,
 * add_entity_manager, update_entity_manager, remove_entity_manager,
 * set_cap_table_entries,
 * create_relationship, update_relationship, remove_relationship,
 * create_compliance_obligation, update_compliance_obligation, mark_obligation_complete,
 * upsert_state_id,
 * update_trust_details, add_entity_role, remove_entity_role,
 * add_partnership_rep, remove_partnership_rep,
 * change_entity_status,
 * create_registration, update_registration,
 * set_custom_field, remove_custom_field.
 *
 * sync_entity_compliance, refresh_document_expectations, and sync_entity_members
 * are *read* tools (no dryRun / approval) and live in entities.ts. They reconcile
 * existing state against rules rather than applying user-intended mutations.
 *
 * Each tool exposes both `handler` (real mutation via apply.ts) and `dryRun`
 * (ownership checks + validation + preview, no mutation).
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { dispatchAction } from "../apply-dispatch";
import { resolveName } from "../resolve-names";
import { getStateLabel } from "@/lib/constants";
import type { Jurisdiction } from "@/lib/types/enums";


// --- create_entity -----------------------------------------------------------

export const createEntityTool = defineTool({
  name: "create_entity",
  description:
    "Create a new internal entity (LLC, trust, person, corp, etc.). Returns the created record.",
  kind: "write",
  inputSchema: z.object({
    name: z.string().min(1),
    type: z.enum([
      "holding_company", "investment_fund", "operating_company", "real_estate",
      "special_purpose", "management_company", "trust", "person", "joint_title", "other",
    ]),
    ein: z.string().optional().nullable(),
    formation_state: z.string().optional().nullable(),
    formed_date: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    registered_agent: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    business_purpose: z.string().optional().nullable(),
  }),
  dryRun: async (input) => ({
    summary: `Create entity: ${input.name} (${input.type})`,
    preview: input,
  }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "create_entity", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- update_entity -----------------------------------------------------------

export const updateEntityTool = defineTool({
  name: "update_entity",
  description: "Update fields on an existing entity. Partial update — only fields present in `fields` are written.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    fields: z.record(z.string(), z.unknown()),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return { summary: `Update ${name}`, preview: input.fields };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "update_entity", {
      entity_id: input.entity_id,
      fields: input.fields,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- archive_entity (uses update_entity with status=inactive) ----------------

export const archiveEntityTool = defineTool({
  name: "archive_entity",
  description: "Set an entity's status to 'inactive'. Reversible — update_entity can set it back to 'active'.",
  kind: "write",
  inputSchema: z.object({ entity_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return { summary: `Archive ${name} (set status to inactive)` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "update_entity", {
      entity_id: input.entity_id,
      status: "inactive",
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Factory for common member/manager/relationship/compliance CRUD tools ----
function simpleWriteTool(
  name: string,
  applyAction: string,
  description: string,
  inputSchema: z.ZodObject<z.ZodRawShape>,
  summaryFn: (input: Record<string, unknown>, ctx: ToolContext) => string | Promise<string>,
  ownershipType: Parameters<typeof verifyResourceOwnership>[1]["resourceType"],
  ownershipIdKey: string,
): ToolDefinition {
  return defineTool({
    name,
    description,
    kind: "write",
    inputSchema,
    dryRun: async (input, ctx) => {
      await verifyResourceOwnership(ctx, { resourceType: ownershipType, resourceId: (input as Record<string, unknown>)[ownershipIdKey] as string });
      return { summary: await summaryFn(input as Record<string, unknown>, ctx) };
    },
    handler: async (input, ctx) => {
      await verifyResourceOwnership(ctx, { resourceType: ownershipType, resourceId: (input as Record<string, unknown>)[ownershipIdKey] as string });
      const result = await dispatchAction(ctx, applyAction, input as Record<string, unknown>);
      return { data: result.data, audit_event_id: result.audit_event_id };
    },
  });
}

type ToolContext = import("../tool-context").ToolContext;

// --- Members -----------------------------------------------------------------

const addMemberTool = simpleWriteTool(
  "add_entity_member", "add_member",
  "Add a member to an entity's ownership structure.",
  z.object({ entity_id: z.string().uuid(), name: z.string().min(1) }),
  async (i, ctx) => `Add member "${i.name}" to ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

const updateMemberTool = simpleWriteTool(
  "update_entity_member", "update_cap_table",
  "Update a member's cap-table entry (ownership %, units, capital contributed).",
  z.object({
    entity_id: z.string().uuid(),
    investor_name: z.string().min(1),
    investor_type: z.string().optional(),
    units: z.number().optional().nullable(),
    ownership_pct: z.number(),
    capital_contributed: z.number().optional().nullable(),
  }),
  async (i, ctx) => `Update member "${i.investor_name}" on ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

const removeMemberTool = simpleWriteTool(
  "remove_entity_member", "update_cap_table",
  "Remove a member by setting ownership to 0%. Does not delete the row.",
  z.object({
    entity_id: z.string().uuid(),
    investor_name: z.string().min(1),
    ownership_pct: z.literal(0),
  }),
  async (i, ctx) => `Remove member "${i.investor_name}" from ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

// --- Managers ----------------------------------------------------------------

const addManagerTool = simpleWriteTool(
  "add_entity_manager", "add_manager",
  "Add a manager (signing authority) to an entity.",
  z.object({ entity_id: z.string().uuid(), name: z.string().min(1) }),
  async (i, ctx) => `Add manager "${i.name}" to ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

const updateManagerTool = simpleWriteTool(
  "update_entity_manager", "add_manager",
  "Update a manager on an entity (upsert by name).",
  z.object({ entity_id: z.string().uuid(), name: z.string().min(1) }),
  async (i, ctx) => `Update manager "${i.name}" on ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

const removeManagerTool = simpleWriteTool(
  "remove_entity_manager", "add_manager",
  "Remove a manager from an entity. Sets the manager entry inactive.",
  z.object({ entity_id: z.string().uuid(), name: z.string().min(1) }),
  async (i, ctx) => `Remove manager "${i.name}" from ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

// --- Cap table ---------------------------------------------------------------

const setCapTableTool = simpleWriteTool(
  "set_cap_table_entries", "update_cap_table",
  "Set or replace a cap-table entry for an entity. Partial allocations (sum < 100%) are valid; sum > 100% is rejected. Do NOT invent filler entries to reach 100%.",
  z.object({
    entity_id: z.string().uuid(),
    investor_name: z.string().min(1),
    investor_type: z.string(),
    units: z.number().optional().nullable(),
    ownership_pct: z.number(),
    capital_contributed: z.number().optional().nullable(),
    replaces_investor_name: z.string().optional().nullable(),
  }),
  async (i, ctx) => `Set cap-table entry: ${i.investor_name} at ${i.ownership_pct}% on ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

// --- Relationships -----------------------------------------------------------

const createRelationshipTool = simpleWriteTool(
  "create_relationship", "create_relationship",
  "Create a financial or legal relationship between two entities or directory entries.",
  z.object({
    from_entity_id: z.string().uuid().optional().nullable(),
    from_directory_id: z.string().uuid().optional().nullable(),
    to_entity_id: z.string().uuid().optional().nullable(),
    to_directory_id: z.string().uuid().optional().nullable(),
    type: z.string(),
    description: z.string(),
    terms: z.string().optional().nullable(),
    frequency: z.string().optional().nullable(),
    annual_estimate: z.number().optional().nullable(),
  }),
  (i) => `Create relationship: ${i.type} — ${i.description}`,
  "entity", "from_entity_id",
);

const updateRelationshipTool = simpleWriteTool(
  "update_relationship", "create_relationship",
  "Update an existing relationship (upsert pattern).",
  z.object({
    from_entity_id: z.string().uuid().optional().nullable(),
    from_directory_id: z.string().uuid().optional().nullable(),
    to_entity_id: z.string().uuid().optional().nullable(),
    to_directory_id: z.string().uuid().optional().nullable(),
    type: z.string(),
    description: z.string(),
    terms: z.string().optional().nullable(),
    frequency: z.string().optional().nullable(),
    annual_estimate: z.number().optional().nullable(),
  }),
  (i) => `Update relationship: ${i.type} — ${i.description}`,
  "entity", "from_entity_id",
);

const removeRelationshipTool = simpleWriteTool(
  "remove_relationship", "create_relationship",
  "Remove a relationship between entities/directory entries.",
  z.object({ relationship_id: z.string().uuid() }),
  async (i, ctx) => `Remove relationship "${await resolveName(ctx, "relationship", i.relationship_id as string)}"`,
  "relationship", "relationship_id",
);

// --- Compliance --------------------------------------------------------------

const createComplianceObligationTool = simpleWriteTool(
  "create_compliance_obligation", "create_compliance_obligation",
  "Create a compliance obligation on an entity. For rule-driven obligations, include rule_id. For ad-hoc obligations (PTET, one-off filings, custom deadlines), omit rule_id. Always check existing obligations first to avoid duplicates.",
  z.object({
    entity_id: z.string().uuid(),
    rule_id: z.string().optional().nullable(),
    name: z.string().min(1),
    obligation_type: z.string().min(1).describe("e.g. franchise_tax, ptet, annual_report, boi, state_tax, custom"),
    jurisdiction: z.string().min(1).describe("e.g. CA, DE, federal"),
    due_date: z.string(),
    recurrence: z.enum(["annual", "quarterly", "monthly", "one_time"]).optional().nullable(),
    notes: z.string().optional().nullable(),
    source: z.enum(["rule", "ai", "user"]).optional().default("ai"),
  }),
  async (i, ctx) => `Create ${i.obligation_type} obligation "${i.name}" (${i.jurisdiction}) due ${i.due_date} on ${await resolveName(ctx, "entity", i.entity_id as string)}`,
  "entity", "entity_id",
);

const updateComplianceObligationTool = simpleWriteTool(
  "update_compliance_obligation", "update_compliance_obligation",
  "Update an existing compliance obligation (name, due date, recurrence, notes, completed_at, document_id). Attach a supporting document by setting document_id.",
  z.object({
    obligation_id: z.string().uuid(),
    name: z.string().optional(),
    due_date: z.string().optional(),
    recurrence: z.enum(["annual", "quarterly", "monthly", "one_time"]).optional().nullable(),
    notes: z.string().optional().nullable(),
    completed_at: z.string().optional().nullable(),
    document_id: z.string().uuid().optional().nullable(),
  }),
  async (i, ctx) => `Update obligation "${await resolveName(ctx, "compliance_obligation", i.obligation_id as string)}"`,
  "compliance_obligation", "obligation_id",
);

const markObligationCompleteTool = simpleWriteTool(
  "mark_obligation_complete", "complete_obligation",
  "Mark a compliance obligation as completed. Optionally record payment amount, confirmation number, notes, and attach a supporting document (e.g., filing confirmation).",
  z.object({
    obligation_id: z.string().uuid(),
    completed_at: z.string().optional(),
    payment_amount: z.number().optional().nullable(),
    confirmation: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    document_id: z.string().uuid().optional().nullable(),
  }),
  async (i, ctx) => `Complete obligation "${await resolveName(ctx, "compliance_obligation", i.obligation_id as string)}"`,
  "compliance_obligation", "obligation_id",
);

// --- State IDs ---------------------------------------------------------------

const upsertStateIdTool = defineTool({
  name: "upsert_state_id",
  description:
    "Set or update the state-assigned entity ID number for a given entity and jurisdiction. " +
    "If a state ID already exists for that entity+jurisdiction, it is updated. " +
    "Use this when you extract a state entity number, SOS number, or file number from a document. " +
    "Common labels: 'Entity Number', 'File Number', 'SOS ID', 'Charter Number'.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    jurisdiction: z.string().describe("Two-letter state code, e.g. 'CA', 'DE', 'NY'."),
    state_id_number: z.string().min(1).describe("The state-assigned ID/entity number."),
    label: z.string().optional().nullable().describe(
      "Optional label for the ID type, e.g. 'Entity Number', 'File Number'. Defaults to 'Entity Number'.",
    ),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return {
      summary: `Set ${getStateLabel(input.jurisdiction as Jurisdiction)} state ID for ${name} to ${input.state_id_number}`,
      preview: {
        entity: name,
        jurisdiction: input.jurisdiction,
        state_id_number: input.state_id_number,
        label: input.label ?? "Entity Number",
      },
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "upsert_state_id", {
      entity_id: input.entity_id,
      jurisdiction: input.jurisdiction,
      state_id_number: input.state_id_number,
      label: input.label ?? "Entity Number",
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Trust details -----------------------------------------------------------

export const updateTrustDetailsTool = defineTool({
  name: "update_trust_details",
  description:
    "Update or create trust-specific details for an entity (trust_type, trust_date, grantor_name, " +
    "situs_state). Creates the trust_details row on first call. Only fields passed are updated.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    trust_type: z.string().optional().describe("e.g. 'revocable', 'irrevocable', 'grantor', 'non_grantor'"),
    trust_date: z.string().optional().nullable().describe("ISO date the trust was formed"),
    grantor_name: z.string().optional().nullable(),
    situs_state: z.string().optional().nullable().describe("2-letter state code for the trust's situs"),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return {
      summary: `Update trust details for ${name}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "update_trust_details", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Entity roles ------------------------------------------------------------

export const addEntityRoleTool = defineTool({
  name: "add_entity_role",
  description:
    "Add a role on an entity — e.g. trustee, successor trustee, beneficiary, tax matters partner, " +
    "general partner. Use this for both trust-specific roles and general entity roles. If the person " +
    "already exists in the org directory, the role is linked by name automatically.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    role_title: z.string().min(1).describe("e.g. 'trustee', 'successor_trustee', 'beneficiary', 'general_partner'"),
    name: z.string().min(1).describe("Person's full name"),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const entity = await resolveName(ctx, "entity", input.entity_id);
    return {
      summary: `Add ${input.role_title} "${input.name}" to ${entity}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "add_role", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const removeEntityRoleTool = defineTool({
  name: "remove_entity_role",
  description:
    "Remove a role from an entity by role_id. Get the role_id from get_trust_details or list_entity_people.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    role_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const entity = await resolveName(ctx, "entity", input.entity_id);
    // Look up the role for a meaningful summary.
    const { data: role } = await ctx.supabase
      .from("entity_roles")
      .select("role_title, name")
      .eq("id", input.role_id)
      .eq("entity_id", input.entity_id)
      .maybeSingle();
    const r = role as { role_title?: string; name?: string } | null;
    const label = r ? `${r.role_title} "${r.name}"` : `role ${input.role_id}`;
    return { summary: `Remove ${label} from ${entity}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "remove_role", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Partnership reps --------------------------------------------------------

export const addPartnershipRepTool = defineTool({
  name: "add_partnership_rep",
  description:
    "Add a partnership representative to an entity. Partnership reps appear in operating agreements " +
    "and are the entity's designated contact for IRS partnership audit procedures. If the person already " +
    "exists in the org directory, the record is linked by name automatically.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    name: z.string().min(1).describe("Partnership representative's full name"),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const entity = await resolveName(ctx, "entity", input.entity_id);
    return {
      summary: `Add partnership rep "${input.name}" to ${entity}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "add_partnership_rep", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const removePartnershipRepTool = defineTool({
  name: "remove_partnership_rep",
  description:
    "Remove a partnership representative from an entity by rep_id.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    rep_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const entity = await resolveName(ctx, "entity", input.entity_id);
    const { data: rep } = await ctx.supabase
      .from("entity_partnership_reps")
      .select("name")
      .eq("id", input.rep_id)
      .eq("entity_id", input.entity_id)
      .maybeSingle();
    const label = (rep as { name?: string } | null)?.name ? `"${(rep as { name: string }).name}"` : `rep ${input.rep_id}`;
    return { summary: `Remove partnership rep ${label} from ${entity}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "remove_partnership_rep", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Entity status -----------------------------------------------------------

const ENTITY_STATUSES = [
  "active",
  "inactive",
  "dissolved",
  "suspended",
  "pending_formation",
  "converting",
] as const;

export const changeEntityStatusTool = defineTool({
  name: "change_entity_status",
  description:
    "Change an entity's lifecycle status (active, inactive, dissolved, suspended, pending_formation, " +
    "converting). Prefer this over update_entity for status changes — the dryRun previews the cascade " +
    "(how many compliance obligations will be exempted and document expectations suppressed). " +
    "Dissolving or inactivating an entity exempts pending obligations and marks unsatisfied expectations " +
    "not applicable; reactivating regenerates obligations and expectations from rules.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    status: z.enum(ENTITY_STATUSES),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);

    const { data: entity } = await ctx.supabase
      .from("entities")
      .select("status")
      .eq("id", input.entity_id)
      .maybeSingle();
    const currentStatus = ((entity as { status?: string } | null)?.status) ?? "unknown";

    if (currentStatus === input.status) {
      return { summary: `${name} is already ${input.status} — no-op` };
    }

    const becomingInactive = input.status !== "active" && currentStatus === "active";
    const becomingActive = input.status === "active" && currentStatus !== "active";

    let detail = "";
    if (becomingInactive) {
      const [pendingObs, unsatisfiedExps] = await Promise.all([
        ctx.supabase
          .from("compliance_obligations")
          .select("*", { count: "exact", head: true })
          .eq("entity_id", input.entity_id)
          .eq("status", "pending"),
        ctx.supabase
          .from("entity_document_expectations")
          .select("*", { count: "exact", head: true })
          .eq("entity_id", input.entity_id)
          .eq("is_satisfied", false)
          .eq("is_not_applicable", false),
      ]);
      const obCount = (pendingObs as { count?: number | null }).count ?? 0;
      const expCount = (unsatisfiedExps as { count?: number | null }).count ?? 0;
      const parts: string[] = [];
      if (obCount > 0) parts.push(`exempt ${obCount} pending obligation${obCount !== 1 ? "s" : ""}`);
      if (expCount > 0) parts.push(`mark ${expCount} expectation${expCount !== 1 ? "s" : ""} not applicable`);
      if (parts.length > 0) detail = ` — will ${parts.join(" and ")}`;
    } else if (becomingActive) {
      detail = " — will regenerate compliance obligations and document expectations from rules";
    }

    return {
      summary: `Change ${name} status from ${currentStatus} to ${input.status}${detail}`,
      preview: { entity: name, from: currentStatus, to: input.status },
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "update_entity", {
      entity_id: input.entity_id,
      fields: { status: input.status },
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Registrations -----------------------------------------------------------

export const createRegistrationTool = defineTool({
  name: "create_registration",
  description:
    "Record a new registration for an entity — either its formation-state registration or a foreign " +
    "qualification in another state. Use after extracting registration info from a Certificate of " +
    "Formation, Certificate of Good Standing, or Foreign Qualification filing. Pairs well with " +
    "sync_entity_compliance to regenerate obligations for the new jurisdiction.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    jurisdiction: z.string().min(2).describe("2-letter state code, e.g. 'DE', 'CA', 'NY'."),
    qualification_date: z.string().optional().nullable().describe("ISO date the entity qualified in this jurisdiction."),
    last_filing_date: z.string().optional().nullable().describe("ISO date of the most recent filing (annual report etc.)."),
    state_id: z.string().optional().nullable().describe("State-assigned entity/file number, e.g. a DE file number."),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    const stateLabel = getStateLabel(input.jurisdiction as Jurisdiction);
    return {
      summary: `Register ${name} in ${stateLabel}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "add_registration", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateRegistrationTool = defineTool({
  name: "update_registration",
  description:
    "Update a registration's details (qualification_date, last_filing_date, state_id). Only the fields " +
    "you pass are touched. last_filing_date is write-once-newer: it only advances when the new date is " +
    "more recent than the stored one.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    registration_id: z.string().uuid(),
    qualification_date: z.string().optional().nullable(),
    last_filing_date: z.string().optional().nullable(),
    state_id: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    const { data: reg } = await ctx.supabase
      .from("entity_registrations")
      .select("jurisdiction")
      .eq("id", input.registration_id)
      .eq("entity_id", input.entity_id)
      .maybeSingle();
    const jurisdiction = (reg as { jurisdiction?: string } | null)?.jurisdiction;
    const label = jurisdiction
      ? `${getStateLabel(jurisdiction as Jurisdiction)} registration`
      : `registration ${input.registration_id}`;
    return {
      summary: `Update ${label} for ${name}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "update_registration", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Custom fields -----------------------------------------------------------

export const setCustomFieldTool = defineTool({
  name: "set_custom_field",
  description:
    "Set a custom field value on an entity. Creates the field definition if it doesn't exist (upsert by " +
    "label). Use for entity-specific data that doesn't fit the standard schema — fiscal year end, fund " +
    "admin contact, tax ID format, etc. Values are stored as text.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    label: z.string().min(1).describe("Human-readable field name, e.g. 'Fiscal Year End' or 'Fund Admin'."),
    value: z.string().describe("Field value as text."),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return {
      summary: `Set "${input.label}" to "${input.value}" on ${name}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "set_custom_field", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const removeCustomFieldTool = defineTool({
  name: "remove_custom_field",
  description:
    "Remove a custom field from an entity by label. Deletes the field definition and its value. " +
    "Global custom fields (defined for all entities) cannot be removed via this tool — only entity-scoped " +
    "definitions are affected.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    label: z.string().min(1),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    return { summary: `Remove custom field "${input.label}" from ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "remove_custom_field", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// Sync tools (sync_entity_compliance, refresh_document_expectations,
// sync_entity_members) are read tools — see entities.ts. They call utility
// functions directly and don't fit the dryRun/approval pattern.

// --- Export -------------------------------------------------------------------

export const entityWriteTools: ToolDefinition[] = [
  createEntityTool,
  updateEntityTool,
  archiveEntityTool,
  addMemberTool,
  updateMemberTool,
  removeMemberTool,
  addManagerTool,
  updateManagerTool,
  removeManagerTool,
  setCapTableTool,
  createRelationshipTool,
  updateRelationshipTool,
  removeRelationshipTool,
  createComplianceObligationTool,
  updateComplianceObligationTool,
  markObligationCompleteTool,
  upsertStateIdTool,
  updateTrustDetailsTool,
  addEntityRoleTool,
  removeEntityRoleTool,
  addPartnershipRepTool,
  removePartnershipRepTool,
  changeEntityStatusTool,
  createRegistrationTool,
  updateRegistrationTool,
  setCustomFieldTool,
  removeCustomFieldTool,
];
