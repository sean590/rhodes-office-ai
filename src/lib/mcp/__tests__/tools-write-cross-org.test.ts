/**
 * Cross-org assertion tests for ALL write tools — data-driven.
 *
 * For each write tool: invoke with user A's ctx and a resource id that
 * doesn't belong to org A → assert ToolError('not_found') thrown from the
 * ownership check. Uses a test table, not 34 hand-written tests.
 *
 * create_entity and create_directory_entry are special: they don't take an
 * existing resource id, so there's no ownership check to fail (the new row
 * is implicitly scoped to ctx.orgId via the handler). We include them but
 * expect SUCCESS from dryRun — validates they run without throwing.
 */

import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "../tool-context";
import type { ToolDefinition } from "../schema";

// Mock audit event so logSensitiveReveal doesn't hit a real DB.
vi.mock("@/lib/utils/audit", () => ({
  logAuditEvent: async () => {},
}));

// Mock applyActions so write tool handlers don't hit a real DB.
vi.mock("@/lib/pipeline/apply", () => ({
  applyActions: async () => ({ results: [{ action: "test", success: true, data: { id: "mock" } }], firstCreatedEntityId: null, createdEntityIds: [] }),
}));

import { entityWriteTools } from "../tools/entities-write";
import { directoryWriteTools } from "../tools/directory-write";
import { investmentWriteTools } from "../tools/investments-write";
import { documentWriteTools } from "../tools/documents-write";
import { serviceProviderWriteTools } from "../tools/service-providers-write";

const ALL_WRITE_TOOLS = [
  ...entityWriteTools,
  ...directoryWriteTools,
  ...investmentWriteTools,
  ...documentWriteTools,
  ...serviceProviderWriteTools,
];

// Mock supabase that returns null for every maybeSingle (ownership fails).
function makeCtx(orgId: string): ToolContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.eq = passthrough;
  chain.is = passthrough;
  chain.ilike = passthrough;
  chain.order = passthrough;
  chain.limit = passthrough;
  chain.neq = passthrough;
  chain.lte = passthrough;
  chain.lt = passthrough;
  chain.gte = passthrough;
  chain.in = passthrough;
  chain.insert = () => Promise.resolve({ data: { id: "new" }, error: null });
  chain.update = () => chain;
  chain.delete = () => chain;
  // Ownership check hits maybeSingle → null = not found = org mismatch.
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return {
    userId: "u-A",
    orgId,
    sessionId: "s",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: () => chain } as any,
    redact: (o) => o,
  };
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

// Tools that create new rows (no existing resource id to ownership-check):
const CREATE_TOOLS = new Set(["create_entity", "create_directory_entry", "create_investment", "create_service_provider"]);

// Build a minimal valid input for each tool's schema so Zod parse passes.
// Fields like entity_id, investment_id, etc. use VALID_UUID (wrong org → ownership fail).
// Instead of trying to infer from Zod shapes (which break on literals, enums
// in Zod 4's internal structure, etc.), use an explicit per-tool override map
// for any tool whose minimal input isn't trivially "{each uuid key → VALID_UUID}".
const INPUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  remove_entity_member: {
    entity_id: VALID_UUID,
    investor_name: "test",
    ownership_pct: 0,
  },
  create_directory_entry: { name: "Test Entry" },
  update_directory_entry: { directory_entry_id: VALID_UUID, name: "Updated" },
  create_entity: {
    name: "Test Entity",
    type: "holding_company",
  },
  create_investment: {
    name: "Test Investment",
    investment_type: "other",
  },
  create_relationship: {
    from_entity_id: VALID_UUID,
    to_entity_id: VALID_UUID,
    type: "other",
    description: "test",
  },
  update_relationship: {
    from_entity_id: VALID_UUID,
    to_entity_id: VALID_UUID,
    type: "other",
    description: "test",
  },
  add_co_investor: {
    investment_id: VALID_UUID,
    directory_entry_id: VALID_UUID,
    role: "co_investor",
  },
  update_co_investor: {
    co_investor_id: VALID_UUID,
    role: "co_investor",
  },
  record_investment_transaction: {
    investment_id: VALID_UUID,
    transaction_type: "contribution",
    amount: 50000,
    transaction_date: "2025-01-01",
  },
  set_investment_allocations: {
    investment_id: VALID_UUID,
    parent_entity_id: VALID_UUID,
    allocations: [{ member_name: "A", allocation_pct: 50 }],
  },
  create_compliance_obligation: {
    entity_id: VALID_UUID,
    name: "Test Obligation",
    obligation_type: "custom",
    jurisdiction: "DE",
    due_date: "2025-06-01",
  },
  upsert_state_id: {
    entity_id: VALID_UUID,
    jurisdiction: "CA",
    state_id_number: "202012345678",
  },
  update_entity_member: {
    entity_id: VALID_UUID,
    investor_name: "test",
    investor_type: "individual",
    ownership_pct: 25,
  },
  set_cap_table_entries: {
    entity_id: VALID_UUID,
    investor_name: "test",
    investor_type: "individual",
    ownership_pct: 25,
  },
  mark_obligation_complete: {
    obligation_id: VALID_UUID,
  },
  unlink_document: {
    document_id: VALID_UUID,
    scope: "entity",
  },
  update_trust_details: {
    entity_id: VALID_UUID,
    trust_type: "revocable",
    situs_state: "DE",
  },
  add_entity_role: {
    entity_id: VALID_UUID,
    role_title: "trustee",
    name: "test",
  },
  remove_entity_role: {
    entity_id: VALID_UUID,
    role_id: VALID_UUID,
  },
  add_partnership_rep: {
    entity_id: VALID_UUID,
    name: "test",
  },
  remove_partnership_rep: {
    entity_id: VALID_UUID,
    rep_id: VALID_UUID,
  },
  change_entity_status: {
    entity_id: VALID_UUID,
    status: "inactive",
  },
  create_registration: {
    entity_id: VALID_UUID,
    jurisdiction: "DE",
  },
  update_registration: {
    entity_id: VALID_UUID,
    registration_id: VALID_UUID,
  },
  set_custom_field: {
    entity_id: VALID_UUID,
    label: "Fiscal Year End",
    value: "December 31",
  },
  remove_custom_field: {
    entity_id: VALID_UUID,
    label: "Fiscal Year End",
  },
  update_document: {
    document_id: VALID_UUID,
    name: "2024 K-1.pdf",
  },
  add_document_expectation: {
    entity_id: VALID_UUID,
    document_type: "k1",
    document_category: "tax",
  },
  dismiss_document_expectation: {
    entity_id: VALID_UUID,
    expectation_id: VALID_UUID,
  },
  accept_document_suggestion: {
    entity_id: VALID_UUID,
    expectation_id: VALID_UUID,
  },
};

function buildInput(tool: ToolDefinition): Record<string, unknown> {
  if (INPUT_OVERRIDES[tool.name]) return INPUT_OVERRIDES[tool.name];
  // Fallback: populate every *_id key with VALID_UUID, common string keys
  // with "test", and hope Zod defaults cover the rest.
  const shape = tool.inputSchema.shape;
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (key.endsWith("_id")) {
      input[key] = VALID_UUID;
    } else if (key === "name" || key === "investor_name" || key === "description") {
      input[key] = "test";
    } else if (key === "fields") {
      input[key] = { status: "active" };
    }
  }
  return input;
}

describe("cross-org ownership gate — all write tools", () => {
  for (const tool of ALL_WRITE_TOOLS) {
    if (CREATE_TOOLS.has(tool.name)) {
      // Create tools don't have ownership checks — just verify dryRun runs.
      it(`${tool.name}: dryRun succeeds (create tool, no ownership check)`, async () => {
        const ctx = makeCtx("org-A");
        const input = buildInput(tool);
        const parsed = tool.inputSchema.parse(input);
        const result = await tool.dryRun!(parsed, ctx);
        expect(result.summary).toBeTruthy();
      });
    } else {
      it(`${tool.name}: dryRun throws not_found when resource belongs to another org`, async () => {
        const ctx = makeCtx("org-A");
        const input = buildInput(tool);
        const parsed = tool.inputSchema.parse(input);
        await expect(tool.dryRun!(parsed, ctx)).rejects.toThrow(/not found/);
      });
    }
  }

  it("covers all 34 write tools from the spec", () => {
    expect(ALL_WRITE_TOOLS.length).toBeGreaterThanOrEqual(34);
  });
});
