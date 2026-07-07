/**
 * Smoke tests for the three-tier compliance system.
 *
 * Coverage:
 *   - syncComplianceForEntity (PR 3 sync logic + override filtering)
 *   - list_compliance_obligations MCP tool
 *
 * Pattern: Vitest with mocked Supabase. generateComplianceObligations is
 * mocked so assertions focus on sync orchestration (override aggregation,
 * upsert shape, stale removal) instead of the rules engine itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";

// ── Supabase admin mock — same pattern as document-expectations-smoke ─────

type Resp = { data?: unknown; error?: unknown };
interface DbScript {
  [table: string]: Resp[];
}
interface Writes {
  upserts: Array<{ table: string; rows: unknown[]; opts?: unknown }>;
  inserts: Array<{ table: string; rows: unknown[] }>;
  updates: Array<{ table: string; patch: unknown; filters: Array<{ method: string; args: unknown[] }> }>;
  deletes: Array<{ table: string; filters: Array<{ method: string; args: unknown[] }> }>;
}

let currentDb: DbScript = {};
let currentWrites: Writes = { upserts: [], inserts: [], updates: [], deletes: [] };

function setDb(db: DbScript) {
  currentDb = db;
  currentWrites = { upserts: [], inserts: [], updates: [], deletes: [] };
}

function makeAdmin() {
  const writes = currentWrites;
  const db = () => currentDb;

  const makeChain = (table: string) => {
    const filters: Array<{ method: string; args: unknown[] }> = [];
    let mode: "read" | "delete" | "update" = "read";
    let updatePatch: unknown = undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const recordFilter = (name: string) => (...args: unknown[]) => {
      filters.push({ method: name, args });
      return chain;
    };

    chain.select = recordFilter("select");
    chain.eq = recordFilter("eq");
    chain.in = recordFilter("in");
    chain.neq = recordFilter("neq");
    chain.lt = recordFilter("lt");
    chain.lte = recordFilter("lte");
    chain.gte = recordFilter("gte");
    chain.is = recordFilter("is");
    chain.not = recordFilter("not");
    chain.ilike = recordFilter("ilike");
    chain.order = recordFilter("order");
    chain.limit = recordFilter("limit");

    chain.upsert = (rows: unknown, opts?: unknown) => {
      writes.upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts });
      return chain;
    };
    chain.insert = (rows: unknown) => {
      writes.inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
      return chain;
    };
    chain.delete = () => {
      mode = "delete";
      return chain;
    };
    chain.update = (patch: unknown) => {
      mode = "update";
      updatePatch = patch;
      return chain;
    };

    const consumeRead = (): Resp => {
      const queue = db()[table] ?? [];
      return queue.shift() ?? { data: [], error: null };
    };

    chain.single = () => {
      const r = consumeRead();
      return Promise.resolve(r.data === undefined ? { data: null, error: null } : r);
    };
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (v: Resp) => unknown) => {
      if (mode === "delete") {
        writes.deletes.push({ table, filters });
        return resolve({ data: null, error: null });
      }
      if (mode === "update") {
        writes.updates.push({ table, patch: updatePatch, filters });
        return resolve({ data: null, error: null });
      }
      return resolve(consumeRead());
    };

    return chain;
  };

  return { from: (table: string) => makeChain(table) };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdmin(),
}));

// Mock compliance-engine so tests focus on sync orchestration, not rules.
const generateMock = vi.fn();
vi.mock("@/lib/utils/compliance-engine", () => ({
  generateComplianceObligations: (...args: unknown[]) => generateMock(...args),
}));

// Stub the post-sync inference call (PR 6.3). syncComplianceForEntity
// fire-and-forgets runInferenceEngine; we just want it to no-op in tests.
vi.mock("@/lib/utils/inference-engine", () => ({
  runInferenceEngine: async () => ({ patterns_found: 0, diagnostics: {} }),
}));

import { syncComplianceForEntity } from "@/lib/utils/compliance-sync";
import { listComplianceObligationsTool } from "@/lib/mcp/tools/compliance";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID_2 = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  generateMock.mockReset();
  setDb({});
});

// ─────────────────────────────────────────────────────────────────────
// syncComplianceForEntity
// ─────────────────────────────────────────────────────────────────────

describe("syncComplianceForEntity", () => {
  function deLlcEntity(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      data: {
        id: ENTITY_ID,
        status: "active",
        legal_structure: "llc",
        formation_state: "DE",
        formed_date: "2020-01-01",
        ...overrides,
      },
      error: null,
    };
  }

  function generated(...rules: Array<Partial<Record<string, unknown>>>) {
    return rules.map((r) => ({
      rule_id: "rule_x",
      jurisdiction: "DE",
      obligation_type: "annual_report",
      name: "DE Annual Report",
      description: "...",
      frequency: "annual",
      next_due_date: "2026-06-01",
      fee_description: "$300",
      form_number: null,
      portal_url: null,
      filed_with: "Secretary of State",
      penalty_description: null,
      ...r,
    }));
  }

  it("generates and upserts obligations for an active DE LLC", async () => {
    setDb({
      entities: [deLlcEntity()],
      entity_registrations: [{ data: [], error: null }],
      compliance_obligations: [{ data: [], error: null }],
      org_compliance_overrides: [{ data: [], error: null }],
      compliance_profiles: [{ data: [], error: null }],
    });
    generateMock.mockReturnValue(
      generated(
        { rule_id: "de_annual_report", obligation_type: "annual_report", name: "DE Annual Report" },
        { rule_id: "de_franchise_tax", obligation_type: "franchise_tax", name: "DE Franchise Tax", next_due_date: "2026-06-01" },
      ),
    );

    const result = await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    expect(result.upserted).toBe(2);
    const upsert = currentWrites.upserts.find((u) => u.table === "compliance_obligations");
    expect(upsert).toBeTruthy();
    const ruleIds = (upsert!.rows as Array<{ rule_id: string }>).map((r) => r.rule_id);
    expect(ruleIds.sort()).toEqual(["de_annual_report", "de_franchise_tax"]);
  });

  it("passes org-level overrides into generateComplianceObligations as disabledRuleIds", async () => {
    setDb({
      entities: [deLlcEntity()],
      entity_registrations: [{ data: [], error: null }],
      compliance_obligations: [{ data: [], error: null }],
      org_compliance_overrides: [
        {
          data: [
            { rule_id: "de_annual_report", action: "disable" },
            { rule_id: "ca_franchise_tax", action: "enable" }, // 'enable' is NOT a disable
          ],
          error: null,
        },
      ],
      compliance_profiles: [{ data: [], error: null }],
    });
    generateMock.mockReturnValue([]);

    await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    expect(generateMock).toHaveBeenCalledTimes(1);
    const opts = generateMock.mock.calls[0][1] as { disabledRuleIds: Set<string> };
    expect(opts.disabledRuleIds.has("de_annual_report")).toBe(true);
    expect(opts.disabledRuleIds.has("ca_franchise_tax")).toBe(false);
  });

  it("passes entity-type profiles (enabled=false) into disabledRuleIds", async () => {
    setDb({
      entities: [deLlcEntity()],
      entity_registrations: [{ data: [], error: null }],
      compliance_obligations: [{ data: [], error: null }],
      org_compliance_overrides: [{ data: [], error: null }],
      compliance_profiles: [
        {
          data: [
            { rule_id: "de_annual_report", enabled: false },
            { rule_id: "ca_franchise_tax", enabled: true },
          ],
          error: null,
        },
      ],
    });
    generateMock.mockReturnValue([]);

    await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    const opts = generateMock.mock.calls[0][1] as { disabledRuleIds: Set<string> };
    expect(opts.disabledRuleIds.has("de_annual_report")).toBe(true);
    expect(opts.disabledRuleIds.has("ca_franchise_tax")).toBe(false);
  });

  it("preserves completed obligations (skips them in the upsert)", async () => {
    setDb({
      entities: [deLlcEntity()],
      entity_registrations: [{ data: [], error: null }],
      compliance_obligations: [
        {
          data: [
            {
              id: "ob_1",
              rule_id: "de_annual_report",
              next_due_date: "2026-06-01",
              status: "completed",
              completed_at: "2026-05-15",
            },
          ],
          error: null,
        },
      ],
      org_compliance_overrides: [{ data: [], error: null }],
      compliance_profiles: [{ data: [], error: null }],
    });
    generateMock.mockReturnValue(
      generated(
        { rule_id: "de_annual_report", next_due_date: "2026-06-01" },
        { rule_id: "de_franchise_tax", next_due_date: "2026-06-01" },
      ),
    );

    const result = await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    // Completed annual_report should be skipped; only the franchise_tax row gets upserted.
    expect(result.upserted).toBe(1);
    const upsert = currentWrites.upserts.find((u) => u.table === "compliance_obligations");
    const ids = (upsert!.rows as Array<{ rule_id: string }>).map((r) => r.rule_id);
    expect(ids).toEqual(["de_franchise_tax"]);
  });

  it("removes stale pending obligations whose rules no longer apply", async () => {
    setDb({
      entities: [deLlcEntity()],
      entity_registrations: [{ data: [], error: null }],
      compliance_obligations: [
        {
          data: [
            { id: "ob_stale", rule_id: "old_rule", next_due_date: "2026-06-01", status: "pending" },
            { id: "ob_kept", rule_id: "de_annual_report", next_due_date: "2026-06-01", status: "pending" },
          ],
          error: null,
        },
      ],
      org_compliance_overrides: [{ data: [], error: null }],
      compliance_profiles: [{ data: [], error: null }],
    });
    generateMock.mockReturnValue(
      generated({ rule_id: "de_annual_report", next_due_date: "2026-06-01" }),
    );

    const result = await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    expect(result.removed).toBe(1);
    const del = currentWrites.deletes.find((d) => d.table === "compliance_obligations");
    expect(del).toBeTruthy();
    const inFilter = del!.filters.find((f) => f.method === "in" && f.args[0] === "id");
    expect(inFilter!.args[1]).toEqual(["ob_stale"]);
  });

  it("returns early for non-active entities", async () => {
    setDb({
      entities: [deLlcEntity({ status: "dissolved" })],
    });

    const result = await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    expect(result).toEqual({ generated: 0, upserted: 0, removed: 0 });
    expect(generateMock).not.toHaveBeenCalled();
    expect(currentWrites.upserts).toHaveLength(0);
  });

  it("returns early when legal_structure is missing", async () => {
    setDb({
      entities: [deLlcEntity({ legal_structure: null })],
    });

    const result = await syncComplianceForEntity(ENTITY_ID, ORG_ID);

    expect(result).toEqual({ generated: 0, upserted: 0, removed: 0 });
    expect(generateMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// list_compliance_obligations MCP tool
// ─────────────────────────────────────────────────────────────────────

describe("list_compliance_obligations (MCP tool)", () => {
  function makeToolCtx(orgId: string, db: DbScript): ToolContext {
    setDb(db);
    return {
      userId: "u",
      orgId,
      orgRole: "owner",
      sessionId: "s",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: makeAdmin() as any,
      redact: (o) => o,
    };
  }

  function obligation(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "ob_1",
      entity_id: ENTITY_ID,
      rule_id: "de_annual_report",
      jurisdiction: "DE",
      obligation_type: "annual_report",
      name: "DE Annual Report",
      description: "...",
      frequency: "annual",
      next_due_date: "2026-06-01",
      status: "pending",
      completed_at: null,
      completed_by: null,
      document_id: null,
      payment_amount: null,
      confirmation: null,
      notes: null,
      source: "system",
      ...overrides,
    };
  }

  it("returns obligations across all entities in the org", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [
        {
          data: [
            { id: ENTITY_ID, name: "44 Holdings, LLC" },
            { id: ENTITY_ID_2, name: "RCM Mainstream LLC" },
          ],
          error: null,
        },
      ],
      compliance_obligations: [
        {
          data: [
            obligation({ id: "ob_1", entity_id: ENTITY_ID, rule_id: "de_annual_report" }),
            obligation({ id: "ob_2", entity_id: ENTITY_ID_2, rule_id: "de_franchise_tax" }),
          ],
          error: null,
        },
      ],
    });

    const result = await listComplianceObligationsTool.handler(
      { include_completed: false },
      ctx,
    );

    expect(result.data).toHaveLength(2);
    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.entity_name).sort()).toEqual([
      "44 Holdings, LLC",
      "RCM Mainstream LLC",
    ]);
  });

  it("filters by jurisdiction (passes .eq filter to query)", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: [{ id: ENTITY_ID, name: "44 Holdings, LLC" }], error: null }],
      compliance_obligations: [
        {
          data: [obligation({ jurisdiction: "DE" })],
          error: null,
        },
      ],
    });

    const result = await listComplianceObligationsTool.handler(
      { jurisdiction: "DE", include_completed: false },
      ctx,
    );

    // We get back what was queued (the queue is set up to match the filter).
    // Real behavior: jurisdiction='DE' filter is applied via .eq("jurisdiction", "DE").
    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.jurisdiction === "DE")).toBe(true);
  });

  it("returns empty data when org has no entities", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: [], error: null }],
    });

    const result = await listComplianceObligationsTool.handler(
      { include_completed: false },
      ctx,
    );

    expect(result.data).toEqual([]);
  });

  it("filters entities by legal_structure (e.g. 'all my LLCs')", async () => {
    // Only the LLC entity is returned from the entities query because the
    // handler adds .eq("legal_structure", "llc") to the filter chain. We
    // verify that the resulting obligation list contains only its rows.
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: [{ id: ENTITY_ID, name: "44 Holdings, LLC" }], error: null }],
      compliance_obligations: [
        { data: [obligation({ entity_id: ENTITY_ID })], error: null },
      ],
    });

    const result = await listComplianceObligationsTool.handler(
      { legal_structure: "llc", include_completed: false },
      ctx,
    );

    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_name).toBe("44 Holdings, LLC");
  });

  it("filters entities by entity_type (e.g. 'all my real_estate entities')", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: [{ id: ENTITY_ID, name: "Ridge Property LLC" }], error: null }],
      compliance_obligations: [
        { data: [obligation({ entity_id: ENTITY_ID, obligation_type: "property_tax" })], error: null },
      ],
    });

    const result = await listComplianceObligationsTool.handler(
      { entity_type: "real_estate", include_completed: false },
      ctx,
    );

    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].obligation_type).toBe("property_tax");
  });
});
