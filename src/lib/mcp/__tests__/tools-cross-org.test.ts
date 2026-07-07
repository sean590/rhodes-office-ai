import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";
import {
  listEntitiesTool,
  getEntityTool,
  getEntityMembersTool,
  getCapTableTool,
  getEntityComplianceTool,
  getEntityRelationshipsTool,
} from "../tools/entities";
import {
  listDirectoryEntriesTool,
  getDirectoryEntryTool,
} from "../tools/directory";
import {
  searchDocumentsTool,
  getDocumentTool,
  listDocumentsForEntityTool,
  listDocumentsForInvestmentTool,
} from "../tools/documents";
import {
  listInvestmentsTool,
  getInvestmentTool,
  listInvestmentTransactionsTool,
  getInvestmentAllocationsTool,
} from "../tools/investments";
import {
  getInvestmentSummaryTool,
  getInvestmentInvestorSummaryTool,
  getEntityInvestmentSummaryTool,
  getPortfolioSummaryTool,
  getCashFlowSummaryTool,
  getEntitySummaryTool,
  getComplianceSummaryTool,
} from "../tools/aggregations";
import { searchAuditLogTool, getRecentActivityTool } from "../tools/audit";

// --- Recording supabase client ---------------------------------------------
//
// The critical security invariant: every read tool's DB query filters by
// ctx.orgId, and caller-supplied arguments cannot override it. The recorder
// captures every `.eq("organization_id", X)` call across the chain and the
// tests assert each captured value matches the session orgId.
//
// Responses are scripted per-table via `script[table]` as a queue of
// {data, error, count} tuples. Each terminal method (single, maybeSingle, then)
// pops the next response for the current table.

interface Resp {
  data?: unknown;
  error?: unknown;
  count?: number;
}

interface Recorder {
  orgIdFilters: string[]; // every organization_id eq value captured
  tables: string[];       // order of `from(...)` calls
}

function makeClient(
  recorder: Recorder,
  script: Record<string, Resp[]>,
): { from: (t: string) => unknown } {
  return {
    from: (table: string) => {
      recorder.tables.push(table);
      const popResp = (): Resp => {
        const queue = script[table] ?? [];
        return queue.shift() ?? { data: [], error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      const passthrough = (..._args: unknown[]) => chain;
      chain.select = passthrough;
      chain.ilike = passthrough;
      chain.order = passthrough;
      chain.limit = passthrough;
      chain.is = passthrough;
      chain.neq = passthrough;
      chain.lte = passthrough;
      chain.lt = passthrough;
      chain.gte = passthrough;
      chain.gt = passthrough;
      chain.in = passthrough;
      chain.eq = (col: string, val: unknown) => {
        if (col === "organization_id") recorder.orgIdFilters.push(String(val));
        return chain;
      };
      chain.single = () => Promise.resolve(popResp());
      chain.maybeSingle = () => Promise.resolve(popResp());
      // Awaiting the chain directly (no terminal) also resolves.
      chain.then = (resolve: (v: Resp) => unknown) => resolve(popResp());
      return chain;
    },
  };
}

function makeCtx(
  orgId: string,
  script: Record<string, Resp[]> = {},
): { ctx: ToolContext; recorder: Recorder } {
  const recorder: Recorder = { orgIdFilters: [], tables: [] };
  const ctx: ToolContext = {
    userId: "u",
    orgId,
    orgRole: "owner",
    sessionId: "s",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeClient(recorder, script) as any,
    redact: (o) => o,
  };
  return { ctx, recorder };
}

beforeEach(() => {
  // nothing — each test builds its own ctx
});

// -----------------------------------------------------------------------------
// list_entities
// -----------------------------------------------------------------------------

describe("list_entities — org scoping", () => {
  it("filters by ctx.orgId", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    await listEntitiesTool.handler({ limit: 25 }, ctx);
    expect(recorder.orgIdFilters).toContain("org-A");
    expect(recorder.orgIdFilters).not.toContain("org-B");
  });

  it("ignores caller-supplied organization_id", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    const parsed = listEntitiesTool.inputSchema.parse({
      organization_id: "org-B",
      limit: 25,
    });
    await listEntitiesTool.handler(parsed, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
  });

  it("isolates concurrent invocations", async () => {
    const a = makeCtx("org-A");
    const b = makeCtx("org-B");
    await Promise.all([
      listEntitiesTool.handler({ limit: 5 }, a.ctx),
      listEntitiesTool.handler({ limit: 5 }, b.ctx),
    ]);
    expect(a.recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(b.recorder.orgIdFilters.every((o) => o === "org-B")).toBe(true);
  });
});

describe("list_entities — truncation", () => {
  it("sets truncated:true when rows exceed limit", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, name: `E${i}` }));
    const { ctx } = makeCtx("org-A", { entities: [{ data: rows, error: null }] });
    const result = await listEntitiesTool.handler({ limit: 10 }, ctx);
    expect(result.truncated).toBe(true);
    expect((result.data as unknown[]).length).toBe(10);
  });

  it("does not set truncated when rows <= limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, name: `E${i}` }));
    const { ctx } = makeCtx("org-A", { entities: [{ data: rows, error: null }] });
    const result = await listEntitiesTool.handler({ limit: 10 }, ctx);
    expect(result.truncated).toBeFalsy();
  });
});

// -----------------------------------------------------------------------------
// Entity-scoped tools — verify that verifyEntityBelongsToOrg gates access
// -----------------------------------------------------------------------------

function entityOwnershipOk(_orgId: string) {
  // First query of every entity-scoped tool is the ownership verification,
  // which looks up `entities` by id+orgId and expects a row back.
  return {
    entities: [{ data: { id: "e-1" }, error: null }],
  };
}

describe("get_entity — rejects entity from another org", () => {
  it("returns not_found when entity doesn't exist in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", {
      entities: [{ data: null, error: null }], // ownership check fails
    });
    await expect(
      getEntityTool.handler({ entity_id: "00000000-0000-0000-0000-000000000001", reveal_sensitive: false }, ctx),
    ).rejects.toThrow(/not found/);
  });

  it("applies ctx.orgId on ownership + every child table that carries organization_id", async () => {
    // Ownership gate (1) + documents (1) + relationships from/to (2) = 4 org
    // filters. trust_details, entity_members, entity_managers,
    // cap_table_entries, compliance_obligations carry no organization_id
    // column, so they do NOT contribute. If this count drifts, a handler has
    // either dropped a required filter or added one to a parent-gate-only
    // table — both are regressions.
    const { ctx, recorder } = makeCtx("org-A", {
      ...entityOwnershipOk("org-A"),
      entities: [
        { data: { id: "e-1" }, error: null }, // ownership
        { data: { id: "e-1", name: "Acme" }, error: null }, // actual fetch
      ],
      trust_details: [{ data: null, error: null }],
      documents: [{ data: null, error: null, count: 0 }],
      entity_members: [{ data: null, error: null, count: 0 }],
      entity_managers: [{ data: null, error: null, count: 0 }],
      cap_table_entries: [{ data: null, error: null, count: 0 }],
      compliance_obligations: [{ data: null, error: null, count: 0 }],
      relationships: [
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 0 },
      ],
    });
    await getEntityTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001", reveal_sensitive: false },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(4);
  });
});

describe("get_entity_members — ownership gate", () => {
  it("throws when ownership check fails", async () => {
    const { ctx } = makeCtx("org-A", { entities: [{ data: null, error: null }] });
    await expect(
      getEntityMembersTool.handler(
        { entity_id: "00000000-0000-0000-0000-000000000001", reveal_sensitive: false },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_cap_table — ownership gate", () => {
  it("throws when ownership check fails", async () => {
    const { ctx } = makeCtx("org-A", { entities: [{ data: null, error: null }] });
    await expect(
      getCapTableTool.handler(
        { entity_id: "00000000-0000-0000-0000-000000000001" },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_entity_compliance — ownership gate", () => {
  it("throws when ownership check fails", async () => {
    const { ctx } = makeCtx("org-A", { entities: [{ data: null, error: null }] });
    await expect(
      getEntityComplianceTool.handler(
        { entity_id: "00000000-0000-0000-0000-000000000001", include_completed: false },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_entity_relationships — ownership gate + org filter", () => {
  it("filters relationships by ctx.orgId on both directions (exact count)", async () => {
    // Ownership gate (1) + relationships from (1) + relationships to (1) = 3.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      relationships: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    await getEntityRelationshipsTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// Directory tools
// -----------------------------------------------------------------------------

describe("list_directory_entries — org scoping", () => {
  it("filters by ctx.orgId", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    await listDirectoryEntriesTool.handler({ limit: 25 }, ctx);
    expect(recorder.orgIdFilters).toContain("org-A");
  });

  it("ignores smuggled organization_id in args", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    const parsed = listDirectoryEntriesTool.inputSchema.parse({
      organization_id: "org-B",
    });
    await listDirectoryEntriesTool.handler(parsed, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Document tools
// -----------------------------------------------------------------------------

describe("search_documents — org scoping", () => {
  it("filters by ctx.orgId", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    await searchDocumentsTool.handler({ query: "tax", limit: 10 }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters).toContain("org-A");
  });
});

describe("get_document — org scoping", () => {
  it("returns null for docs outside the org", async () => {
    const { ctx } = makeCtx("org-A", { documents: [{ data: null, error: null }] });
    const result = await getDocumentTool.handler(
      { document_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(result.data).toBeNull();
  });
});

describe("list_documents_for_entity — ownership gate", () => {
  it("throws when entity is outside ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", { entities: [{ data: null, error: null }] });
    await expect(
      listDocumentsForEntityTool.handler(
        { entity_id: "00000000-0000-0000-0000-000000000001", limit: 10 },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("list_documents_for_investment — ownership gate", () => {
  it("throws when investment is outside ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", { investments: [{ data: null, error: null }] });
    await expect(
      listDocumentsForInvestmentTool.handler(
        { investment_id: "00000000-0000-0000-0000-000000000001", limit: 10 },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

// -----------------------------------------------------------------------------
// Investment tools
// -----------------------------------------------------------------------------

describe("list_investments — org scoping", () => {
  it("filters by ctx.orgId (exact count 1 for non-investor variant)", async () => {
    const { ctx, recorder } = makeCtx("org-A");
    await listInvestmentsTool.handler({ limit: 10 }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(1);
  });

  // Regression guard — migration 032 dropped `investments.parent_entity_id`.
  // If a future PR re-adds the filter to the Zod schema, the schema inspect
  // below fails loudly. Keeps the smoke failure from silently returning.
  it("schema does not expose parent_entity_id (dropped in migration 032)", () => {
    const keys = Object.keys(listInvestmentsTool.inputSchema.shape);
    expect(keys).not.toContain("parent_entity_id");
    // The canonical replacement is investor_entity_id, which routes through
    // the investment_investors join table.
    expect(keys).toContain("investor_entity_id");
  });

  it("also scopes the investor_entity_id pre-filter query to ctx.orgId (exact count)", async () => {
    // investment_investors pre-query (1) + investments main query (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investment_investors: [{ data: [{ investment_id: "i-1" }], error: null }],
    });
    await listInvestmentsTool.handler(
      {
        investor_entity_id: "00000000-0000-0000-0000-000000000001",
        limit: 10,
      },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.filter((o) => o === "org-A").length).toBe(2);
  });
});

describe("get_investment — ownership gate", () => {
  it("throws when investment not in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", { investments: [{ data: null, error: null }] });
    await expect(
      getInvestmentTool.handler(
        { investment_id: "00000000-0000-0000-0000-000000000001" },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("list_investment_transactions — ownership gate", () => {
  it("throws when investment not in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", { investments: [{ data: null, error: null }] });
    await expect(
      listInvestmentTransactionsTool.handler(
        { investment_id: "00000000-0000-0000-0000-000000000001", limit: 10 },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_investment_allocations — ownership gate", () => {
  it("throws when parent investment_investor not in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", {
      investment_investors: [{ data: null, error: null }],
    });
    await expect(
      getInvestmentAllocationsTool.handler(
        { investment_investor_id: "00000000-0000-0000-0000-000000000001" },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_directory_entry — org scoping", () => {
  it("returns null for an entry not in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", {
      directory_entries: [{ data: null, error: null }],
    });
    const result = await getDirectoryEntryTool.handler(
      { directory_entry_id: "00000000-0000-0000-0000-000000000001", reveal_sensitive: false },
      ctx,
    );
    expect(result.data).toBeNull();
  });

  it("applies ctx.orgId on every child table that carries organization_id (exact count)", async () => {
    // Directory entry primary select (1) + investment_co_investors (1) +
    // investment_allocations (1) + relationships from/to (2) = 5. The other
    // three child tables (entity_members, entity_managers, cap_table_entries)
    // carry no organization_id — intentional exception, see tool-helpers.ts.
    const { ctx, recorder } = makeCtx("org-A", {
      directory_entries: [{ data: { id: "d-1", name: "X" }, error: null }],
      entity_members: [{ data: null, error: null, count: 0 }],
      entity_managers: [{ data: null, error: null, count: 0 }],
      cap_table_entries: [{ data: null, error: null, count: 0 }],
      investment_co_investors: [{ data: null, error: null, count: 0 }],
      investment_allocations: [{ data: null, error: null, count: 0 }],
      relationships: [
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 0 },
      ],
    });
    await getDirectoryEntryTool.handler(
      { directory_entry_id: "00000000-0000-0000-0000-000000000001", reveal_sensitive: false },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(5);
  });
});

// -----------------------------------------------------------------------------
// Exact-count pins for investment tools (belt-and-suspenders regression guard)
// -----------------------------------------------------------------------------

describe("get_investment — org filter count pin", () => {
  it("applies ctx.orgId on ownership + all 3 child-table reads (exact count)", async () => {
    // Ownership (1) + investment_investors (1) + investment_co_investors (1)
    // + investment_transactions (1) = 4. All four tables carry
    // organization_id.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: { id: "i-1", name: "Deal" }, error: null }],
      investment_investors: [{ data: [], error: null }],
      investment_co_investors: [{ data: [], error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getInvestmentTool.handler(
      { investment_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(4);
  });
});

describe("list_investment_transactions — org filter count pin", () => {
  it("applies ctx.orgId on ownership + transactions query (exact count)", async () => {
    // Ownership (1) + transactions (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: { id: "i-1" }, error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await listInvestmentTransactionsTool.handler(
      { investment_id: "00000000-0000-0000-0000-000000000001", limit: 10 },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });
});

describe("get_investment_allocations — org filter count pin", () => {
  it("applies ctx.orgId on parent stake + allocations query (exact count)", async () => {
    // investment_investors parent (1) + investment_allocations (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investment_investors: [{ data: { id: "ii-1", investment_id: "i-1" }, error: null }],
      investment_allocations: [{ data: [], error: null }],
    });
    await getInvestmentAllocationsTool.handler(
      { investment_investor_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Aggregation tools — belt-and-suspenders count pins
// -----------------------------------------------------------------------------

describe("get_investment_summary — org filter count pin", () => {
  it("applies ctx.orgId on ownership + txns + investors (exact count)", async () => {
    // Ownership (1) + investment_transactions (1) + investment_investors (1) = 3.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: { id: "i-1" }, error: null }],
      investment_transactions: [{ data: [], error: null }],
      investment_investors: [{ data: [], error: null }],
    });
    await getInvestmentSummaryTool.handler(
      { investment_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
  });
});

describe("get_investment_investor_summary — org filter count pin", () => {
  it("applies ctx.orgId on parent stake + txns (exact count)", async () => {
    // investment_investors parent (1) + investment_transactions (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investment_investors: [
        { data: { id: "ii-1", investment_id: "i-1", committed_capital: 100 }, error: null },
      ],
      investment_transactions: [{ data: [], error: null }],
    });
    await getInvestmentInvestorSummaryTool.handler(
      { investment_investor_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });
});

describe("get_entity_investment_summary — org filter count pin", () => {
  it("applies ctx.orgId on ownership + investors + txns (exact count, stakes>0)", async () => {
    // Ownership (1) + investment_investors pre-query (1) + investment_transactions (1) = 3.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      investment_investors: [
        { data: [{ id: "ii-1", investment_id: "i-1", committed_capital: 100 }], error: null },
      ],
      investment_transactions: [{ data: [], error: null }],
    });
    await getEntityInvestmentSummaryTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
  });

  it("short-circuits when no stakes exist (only ownership + investors queries scoped)", async () => {
    // Ownership (1) + investment_investors pre-query returns []  (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      investment_investors: [{ data: [], error: null }],
    });
    await getEntityInvestmentSummaryTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });
});

describe("get_portfolio_summary — org filter count pin", () => {
  it("scopes investments + investment_investors + txns (exact count, non-empty)", async () => {
    // investments (1) + investment_investors (1) + investment_transactions (1) = 3.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: [{ id: "i-1", name: "Deal A", investment_type: "fund", date_invested: null }], error: null }],
      investment_investors: [{ data: [], error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getPortfolioSummaryTool.handler({ group_by: "none" }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
  });

  it("group_by='investment' uses the same 3 queries (name resolved from existing invRows)", async () => {
    // No extra query — bucket labels come from the investments SELECT we
    // already make. Count stays at 3.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: [{ id: "i-1", name: "Deal A", investment_type: "fund", date_invested: null }], error: null }],
      investment_investors: [
        { data: [{ id: "ii-1", entity_id: "e-1", investment_id: "i-1", committed_capital: 100 }], error: null },
      ],
      investment_transactions: [
        {
          data: [
            {
              transaction_type: "contribution",
              amount: 50,
              transaction_date: "2025-01-15",
              investment_investor_id: "ii-1",
              investment_id: "i-1",
            },
          ],
          error: null,
        },
      ],
    });
    const result = await getPortfolioSummaryTool.handler({ group_by: "investment" }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
    // Sanity on the response shape — buckets carry investment_id + human name.
    const groups = (result.data as unknown as { groups: Array<Record<string, unknown>> }).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("Deal A");
    expect(groups[0].investment_id).toBe("i-1");
    expect(groups[0].committed).toBe(100);
  });

  it("group_by='entity' adds one extra entities lookup (exact count 4)", async () => {
    // investments (1) + investment_investors (1) + investment_transactions (1)
    // + entities (1, for name resolution) = 4.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: [{ id: "i-1", name: "Deal A", investment_type: "fund", date_invested: null }], error: null }],
      investment_investors: [
        { data: [{ id: "ii-1", entity_id: "e-1", investment_id: "i-1", committed_capital: 100 }], error: null },
      ],
      investment_transactions: [{ data: [], error: null }],
      entities: [{ data: [{ id: "e-1", name: "RCM" }], error: null }],
    });
    await getPortfolioSummaryTool.handler({ group_by: "entity" }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(4);
  });
});

describe("get_cash_flow_summary — org filter count pin", () => {
  it("scopes to ctx.orgId on 'portfolio' scope (exact count)", async () => {
    // investments (1) + investment_transactions (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: [{ id: "i-1" }], error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getCashFlowSummaryTool.handler(
      { scope: { type: "portfolio" }, period: "month" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });

  it("scopes 'investment' scope on ownership + txns (exact count)", async () => {
    // Ownership (1) + investment_transactions (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: { id: "i-1" }, error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getCashFlowSummaryTool.handler(
      {
        scope: { type: "investment", id: "00000000-0000-0000-0000-000000000001" },
        period: "month",
      },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });

  it("scopes 'investor' scope on parent stake + txns (exact count)", async () => {
    // investment_investors parent-stake lookup (1) + investment_transactions (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      investment_investors: [{ data: { id: "ii-1" }, error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getCashFlowSummaryTool.handler(
      {
        scope: { type: "investor", id: "00000000-0000-0000-0000-000000000001" },
        period: "month",
      },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });

  it("scopes 'entity' scope on ownership + investors pre-query + txns (exact count)", async () => {
    // Ownership (1) + investment_investors pre-query (1) + investment_transactions (1) = 3.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      investment_investors: [{ data: [{ id: "ii-1" }], error: null }],
      investment_transactions: [{ data: [], error: null }],
    });
    await getCashFlowSummaryTool.handler(
      {
        scope: { type: "entity", id: "00000000-0000-0000-0000-000000000001" },
        period: "month",
      },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(3);
  });
});

describe("get_entity_summary — org filter count pin", () => {
  it("applies ctx.orgId on ownership + documents + 2 relationships (exact count)", async () => {
    // Ownership (1) + documents (1) + relationships from (1) + relationships to (1) = 4.
    // compliance_obligations, cap_table_entries, entity_members, entity_managers
    // carry no organization_id — intentional exception.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      documents: [{ data: null, error: null, count: 0 }],
      compliance_obligations: [
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 0 },
      ],
      cap_table_entries: [{ data: null, error: null, count: 0 }],
      relationships: [
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 0 },
      ],
      entity_members: [{ data: null, error: null, count: 0 }],
      entity_managers: [{ data: null, error: null, count: 0 }],
    });
    await getEntitySummaryTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(4);
  });
});

describe("get_compliance_summary — org filter count pin", () => {
  it("scopes entities query (exact count, compliance_obligations has no orgId)", async () => {
    // entities (1) — compliance_obligations carries no organization_id.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: [{ id: "e-1", name: "Acme" }], error: null }],
      compliance_obligations: [{ data: [], error: null }],
    });
    await getComplianceSummaryTool.handler({ days_ahead: 30 }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Audit tools
// -----------------------------------------------------------------------------

describe("search_audit_log — org filter count pin", () => {
  it("applies ctx.orgId on the single audit_log query (exact count)", async () => {
    const { ctx, recorder } = makeCtx("org-A", {
      audit_log: [{ data: [], error: null }],
    });
    await searchAuditLogTool.handler({ limit: 10 }, ctx);
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(1);
  });
});

describe("get_recent_activity — org filter count pins", () => {
  it("organization scope: single audit_log query (exact count 1)", async () => {
    const { ctx, recorder } = makeCtx("org-A", {
      audit_log: [{ data: [], error: null }],
    });
    await getRecentActivityTool.handler(
      { scope: { type: "organization" }, limit: 10 },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(1);
  });

  it("entity scope: ownership gate + audit_log (exact count 2)", async () => {
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      audit_log: [{ data: [], error: null }],
    });
    await getRecentActivityTool.handler(
      { scope: { type: "entity", id: "00000000-0000-0000-0000-000000000001" }, limit: 10 },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });

  it("investment scope: ownership gate + audit_log (exact count 2)", async () => {
    const { ctx, recorder } = makeCtx("org-A", {
      investments: [{ data: { id: "i-1" }, error: null }],
      audit_log: [{ data: [], error: null }],
    });
    await getRecentActivityTool.handler(
      { scope: { type: "investment", id: "00000000-0000-0000-0000-000000000001" }, limit: 10 },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });

  it("entity scope: throws when entity not in ctx.orgId", async () => {
    const { ctx } = makeCtx("org-A", { entities: [{ data: null, error: null }] });
    await expect(
      getRecentActivityTool.handler(
        { scope: { type: "entity", id: "00000000-0000-0000-0000-000000000001" }, limit: 10 },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("list_documents_for_entity — org filter count pin", () => {
  it("applies ctx.orgId on ownership + documents query (exact count)", async () => {
    // Ownership (1) + documents (1) = 2.
    const { ctx, recorder } = makeCtx("org-A", {
      entities: [{ data: { id: "e-1" }, error: null }],
      documents: [{ data: [], error: null }],
    });
    await listDocumentsForEntityTool.handler(
      { entity_id: "00000000-0000-0000-0000-000000000001", limit: 10 },
      ctx,
    );
    expect(recorder.orgIdFilters.every((o) => o === "org-A")).toBe(true);
    expect(recorder.orgIdFilters.length).toBe(2);
  });
});
