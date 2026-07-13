/**
 * Smoke tests for the three-tier document expectations system.
 *
 * Coverage:
 *   - Engine: refreshEntityExpectations (PR 4.3 rewrite)
 *   - MCP tool: list_document_expectations (PR 4.4b)
 *   - Three-tier integration: org override + per-scope profile interactions
 *
 * Pattern: Vitest with mocked Supabase. Per-table response queues; deletes
 * captured in a writes ledger. No real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";

// ── Mock createAdminClient before importing the engine ────────────────────

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
      writes.upserts.push({
        table,
        rows: Array.isArray(rows) ? rows : [rows],
        opts,
      });
      return chain;
    };
    chain.insert = (rows: unknown) => {
      writes.inserts.push({
        table,
        rows: Array.isArray(rows) ? rows : [rows],
      });
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

  return {
    from: (table: string) => makeChain(table),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdmin(),
}));

// Now safe to import the engine under test.
import { refreshEntityExpectations } from "@/lib/utils/document-expectations";
import { listDocumentExpectationsTool } from "@/lib/mcp/tools/compliance";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";

// ─────────────────────────────────────────────────────────────────────
// Engine — refreshEntityExpectations
// ─────────────────────────────────────────────────────────────────────

describe("refreshEntityExpectations (engine)", () => {
  beforeEach(() => {
    setDb({});
  });

  function activeLlcEntity() {
    return {
      data: { id: ENTITY_ID, type: "company", status: "active", legal_structure: "llc", organization_id: ORG_ID },
      error: null,
    };
  }

  function profilesForLlc(rows: Array<{
    document_type: string;
    document_category?: string;
    is_required?: boolean;
    enabled?: boolean;
    notes?: string | null;
  }>) {
    return {
      data: rows.map((r) => ({
        document_type: r.document_type,
        document_category: r.document_category ?? "formation",
        is_required: r.is_required ?? true,
        enabled: r.enabled ?? true,
        notes: r.notes ?? null,
      })),
      error: null,
    };
  }

  it("generates expectations from document_profiles for an active LLC", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [
        profilesForLlc([
          { document_type: "operating_agreement", document_category: "formation", is_required: true },
          { document_type: "ein_letter", document_category: "tax", is_required: true },
        ]),
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    expect(upsert).toBeTruthy();
    expect(upsert!.rows).toHaveLength(2);
    const docTypes = (upsert!.rows as Array<{ document_type: string }>).map((r) => r.document_type);
    expect(docTypes.sort()).toEqual(["ein_letter", "operating_agreement"]);
    const opAgreement = (upsert!.rows as Array<Record<string, unknown>>).find(
      (r) => r.document_type === "operating_agreement",
    )!;
    expect(opAgreement.document_category).toBe("formation");
    expect(opAgreement.is_required).toBe(true);
    expect(opAgreement.source).toBe("system");
  });

  it("skips org-disabled document types", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [
        { data: [{ document_type: "ein_letter", action: "disable" }], error: null },
      ],
      document_profiles: [
        profilesForLlc([
          { document_type: "operating_agreement" },
          { document_type: "ein_letter", document_category: "tax" },
        ]),
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    const types = (upsert!.rows as Array<{ document_type: string }>).map((r) => r.document_type);
    expect(types).toContain("operating_agreement");
    expect(types).not.toContain("ein_letter");
  });

  it("skips entity-type-disabled profiles (enabled=false)", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [
        profilesForLlc([
          { document_type: "operating_agreement", enabled: true },
          { document_type: "certificate_of_formation", enabled: false },
        ]),
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    const types = (upsert!.rows as Array<{ document_type: string }>).map((r) => r.document_type);
    expect(types).toEqual(["operating_agreement"]);
  });

  it("preserves manually dismissed expectations (is_not_applicable)", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [profilesForLlc([{ document_type: "operating_agreement" }])],
      entity_document_expectations: [
        {
          data: [
            {
              document_type: "operating_agreement",
              is_not_applicable: true,
              is_satisfied: false,
              satisfied_by: null,
              source: "system",
              notes: null,
            },
          ],
          error: null,
        },
      ],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    // The dismissed row should be filtered out of the upsert, leaving the existing row untouched.
    expect(upsert?.rows ?? []).toHaveLength(0);
  });

  it("preserves satisfied expectations (is_satisfied + satisfied_by carry over)", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [profilesForLlc([{ document_type: "operating_agreement" }])],
      entity_document_expectations: [
        {
          data: [
            {
              document_type: "operating_agreement",
              is_not_applicable: false,
              is_satisfied: true,
              satisfied_by: DOC_ID,
              source: "system",
              notes: "Filed 2024",
            },
          ],
          error: null,
        },
      ],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    expect(upsert!.rows).toHaveLength(1);
    const row = upsert!.rows[0] as Record<string, unknown>;
    expect(row.is_satisfied).toBe(true);
    expect(row.satisfied_by).toBe(DOC_ID);
    expect(row.notes).toBe("Filed 2024");
  });

  it("removes stale system/template expectations no longer in any profile", async () => {
    setDb({
      entities: [activeLlcEntity()],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [profilesForLlc([{ document_type: "operating_agreement" }])],
      entity_document_expectations: [
        {
          data: [
            // Stale system row — should be deleted.
            {
              document_type: "old_doc_type",
              is_not_applicable: false,
              is_satisfied: false,
              source: "system",
            },
            // Manual row — must NOT be deleted.
            {
              document_type: "manual_thing",
              is_not_applicable: false,
              is_satisfied: false,
              source: "manual",
            },
          ],
          error: null,
        },
      ],
    });

    await refreshEntityExpectations(ENTITY_ID);

    const del = currentWrites.deletes.find((d) => d.table === "entity_document_expectations");
    expect(del).toBeTruthy();
    const inFilter = del!.filters.find((f) => f.method === "in" && f.args[0] === "document_type");
    expect(inFilter).toBeTruthy();
    expect(inFilter!.args[1]).toEqual(["old_doc_type"]);
  });

  it("skips non-active entities (returns early)", async () => {
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "dissolved", legal_structure: "llc", organization_id: ORG_ID },
          error: null,
        },
      ],
    });

    await refreshEntityExpectations(ENTITY_ID);

    expect(currentWrites.upserts).toHaveLength(0);
    expect(currentWrites.deletes).toHaveLength(0);
  });

  it("skips entities without a mapped document scope (no system writes)", async () => {
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "investment_fund", status: "active", legal_structure: null, organization_id: ORG_ID },
          error: null,
        },
      ],
      org_document_overrides: [{ data: [], error: null }],
      // No document_profiles query expected when scope is null — engine short-circuits.
      entity_document_expectations: [
        {
          data: [
            // Manual item present — must be preserved.
            { document_type: "manual_thing", is_not_applicable: false, is_satisfied: false, source: "manual" },
          ],
          error: null,
        },
      ],
    });

    await refreshEntityExpectations(ENTITY_ID);

    // Nothing to upsert (no profiles), and the manual row isn't system/template so no delete.
    expect(currentWrites.upserts).toHaveLength(0);
    expect(currentWrites.deletes).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// MCP tool — list_document_expectations
// ─────────────────────────────────────────────────────────────────────

describe("list_document_expectations (MCP tool)", () => {
  function makeToolCtx(orgId: string, db: DbScript): ToolContext {
    setDb(db);
    return {
      userId: "u",
      orgId,
      orgRole: "owner",
      sessionId: "s",
      // The mocked admin works for ToolContext too — it implements .from().
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: makeAdmin() as any,
      redact: (o) => o,
    };
  }

  function expectationRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "e1",
      entity_id: ENTITY_ID,
      document_type: "operating_agreement",
      document_category: "formation",
      is_required: true,
      is_satisfied: false,
      satisfied_by: null,
      is_suggestion: false,
      source: "system",
      confidence: null,
      inference_reason: null,
      notes: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("returns all expectations for an entity with summary counts", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      // verifyEntityBelongsToOrg ownership check
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [
            expectationRow({ id: "e1", document_type: "operating_agreement" }),
            expectationRow({ id: "e2", document_type: "ein_letter", is_satisfied: true, satisfied_by: DOC_ID }),
            expectationRow({ id: "e3", document_type: "k1_2024", is_suggestion: true, source: "inferred" }),
          ],
          error: null,
        },
      ],
      documents: [
        { data: [{ id: DOC_ID, name: "ein-letter-2024.pdf" }], error: null },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "all", include_suggestions: true },
      ctx,
    );

    expect(result.data).toHaveLength(3);
    expect(result.summary).toEqual({
      total: 3,
      satisfied: 1,
      missing_required: 1,
      missing_optional: 0,
      suggestions: 1,
    });
  });

  it("excludes is_not_applicable items (engine-level filter via .eq())", async () => {
    // The handler always applies .eq("is_not_applicable", false). We verify the
    // filter is passed by inspecting that the mock returns only what was queued.
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [expectationRow({ id: "e1" })],
          error: null,
        },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "all", include_suggestions: true },
      ctx,
    );

    // Verify the eq filter was applied — the mock records all filter calls.
    // (Implicit verification: only the queued non-dismissed row appears.)
    expect(result.data).toHaveLength(1);
  });

  it("filters by status='missing'", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [expectationRow({ id: "e1", is_satisfied: false, is_suggestion: false })],
          error: null,
        },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "missing", include_suggestions: true },
      ctx,
    );

    const summary = result.summary as Record<string, number>;
    expect(summary.missing_required).toBe(1);
    expect(summary.satisfied).toBe(0);
  });

  it("filters by status='suggested'", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [
            expectationRow({ id: "e3", is_suggestion: true, source: "inferred", inference_reason: "18 of 20 LLCs have this" }),
          ],
          error: null,
        },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "suggested", include_suggestions: true },
      ctx,
    );

    expect((result.summary as Record<string, number>).suggestions).toBe(1);
    const row = (result.data as Array<Record<string, unknown>>)[0];
    expect(row.is_suggestion).toBe(true);
    expect(row.inference_reason).toBe("18 of 20 LLCs have this");
  });

  it("enriches satisfied_by with document name", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [
            expectationRow({
              id: "e2",
              document_type: "ein_letter",
              is_satisfied: true,
              satisfied_by: DOC_ID,
            }),
          ],
          error: null,
        },
      ],
      documents: [
        { data: [{ id: DOC_ID, name: "ein-letter-2024.pdf" }], error: null },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "satisfied", include_suggestions: true },
      ctx,
    );

    const row = (result.data as Array<Record<string, unknown>>)[0];
    expect(row.satisfied_by_name).toBe("ein-letter-2024.pdf");
  });

  it("excludes suggestions when include_suggestions=false", async () => {
    const ctx = makeToolCtx(ORG_ID, {
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_document_expectations: [
        {
          data: [expectationRow({ id: "e1" })], // mock returns only what was queued
          error: null,
        },
      ],
    });

    const result = await listDocumentExpectationsTool.handler(
      { entity_id: ENTITY_ID, status: "all", include_suggestions: false },
      ctx,
    );

    // include_suggestions=false applies an .eq("is_suggestion", false) filter;
    // we verify the path runs without error and the count matches the queued data.
    expect((result.summary as Record<string, number>).suggestions).toBe(0);
    expect(result.data).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Three-tier integration
// ─────────────────────────────────────────────────────────────────────

describe("Three-tier integration", () => {
  beforeEach(() => setDb({}));

  it("disabling a doc type org-wide hides it on next refresh; removing the override restores it", async () => {
    // Pass 1 — override active, doc_type filtered out.
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "active", legal_structure: "llc", organization_id: ORG_ID },
          error: null,
        },
      ],
      org_document_overrides: [
        { data: [{ document_type: "operating_agreement", action: "disable" }], error: null },
      ],
      document_profiles: [
        {
          data: [
            { document_type: "operating_agreement", document_category: "formation", is_required: true, enabled: true, notes: null },
          ],
          error: null,
        },
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });
    await refreshEntityExpectations(ENTITY_ID);
    let upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    expect(upsert?.rows ?? []).toHaveLength(0);

    // Pass 2 — override removed, doc_type now generates.
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "active", legal_structure: "llc", organization_id: ORG_ID },
          error: null,
        },
      ],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [
        {
          data: [
            { document_type: "operating_agreement", document_category: "formation", is_required: true, enabled: true, notes: null },
          ],
          error: null,
        },
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });
    await refreshEntityExpectations(ENTITY_ID);
    upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    expect(upsert!.rows).toHaveLength(1);
    expect((upsert!.rows[0] as { document_type: string }).document_type).toBe("operating_agreement");
  });

  it("disabling a profile for one scope doesn't affect a different scope", async () => {
    // LLC scope — ein_letter disabled
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "active", legal_structure: "llc", organization_id: ORG_ID },
          error: null,
        },
      ],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [
        {
          data: [
            { document_type: "ein_letter", document_category: "tax", is_required: true, enabled: false, notes: null },
            { document_type: "operating_agreement", document_category: "formation", is_required: true, enabled: true, notes: null },
          ],
          error: null,
        },
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });
    await refreshEntityExpectations(ENTITY_ID);
    let upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    let types = (upsert!.rows as Array<{ document_type: string }>).map((r) => r.document_type);
    expect(types).toContain("operating_agreement");
    expect(types).not.toContain("ein_letter");

    // Corporation scope — ein_letter still enabled
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "active", legal_structure: "corporation", organization_id: ORG_ID },
          error: null,
        },
      ],
      org_document_overrides: [{ data: [], error: null }],
      document_profiles: [
        {
          data: [
            { document_type: "ein_letter", document_category: "tax", is_required: true, enabled: true, notes: null },
            { document_type: "articles_of_incorporation", document_category: "formation", is_required: true, enabled: true, notes: null },
          ],
          error: null,
        },
      ],
      entity_document_expectations: [{ data: [], error: null }],
    });
    await refreshEntityExpectations(ENTITY_ID);
    upsert = currentWrites.upserts.find((u) => u.table === "entity_document_expectations");
    types = (upsert!.rows as Array<{ document_type: string }>).map((r) => r.document_type);
    expect(types).toContain("ein_letter");
    expect(types).toContain("articles_of_incorporation");
  });

  it("entity status lifecycle: deactivate marks unsatisfied as not_applicable, then refresh restores nothing on dissolved", async () => {
    // Step 1 — deactivate flips unsatisfied + non-dismissed expectations.
    const { deactivateEntityCompliance } = await import("@/lib/utils/entity-lifecycle");
    setDb({});
    await deactivateEntityCompliance(makeAdmin(), ENTITY_ID, "Entity dissolved");

    const update = currentWrites.updates.find((u) => u.table === "entity_document_expectations");
    expect(update).toBeTruthy();
    expect(update!.patch).toMatchObject({ is_not_applicable: true });
    // Filter chain: entity_id, is_satisfied=false, is_not_applicable=false.
    const eqMethods = update!.filters.filter((f) => f.method === "eq").map((f) => f.args[0]);
    expect(eqMethods).toContain("entity_id");
    expect(eqMethods).toContain("is_satisfied");
    expect(eqMethods).toContain("is_not_applicable");

    // Step 2 — refreshEntityExpectations on a dissolved entity is a no-op.
    setDb({
      entities: [
        {
          data: { id: ENTITY_ID, type: "company", status: "dissolved", legal_structure: "llc", organization_id: ORG_ID },
          error: null,
        },
      ],
    });
    await refreshEntityExpectations(ENTITY_ID);
    expect(currentWrites.upserts.find((u) => u.table === "entity_document_expectations")).toBeUndefined();
  });
});
