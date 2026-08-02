import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Supabase admin-client mock ---
//
// apply.ts chains supabase-js calls like
//   supabase.from("t").select("*").eq("id", x).maybeSingle()
// For tests we need a configurable chain that lets each describe-block stage
// canned responses per-table-per-operation. The mock tracks a mutable script
// keyed by table; whichever terminal method (single/maybeSingle/select/insert/
// update/delete/upsert) the handler calls, the mock returns the next scripted
// result for that table.

type Resp = { data: unknown; error: unknown; count?: number };

interface Script {
  [table: string]: Resp[];
}

const script: Script = {};
const captured: Array<{ table: string; op: string; payload?: unknown }> = [];

function push(table: string, resp: Resp) {
  if (!script[table]) script[table] = [];
  script[table].push(resp);
}

function popResp(table: string): Resp {
  const arr = script[table];
  if (!arr || arr.length === 0) {
    return { data: null, error: null };
  }
  return arr.shift()!;
}

function makeQuery(table: string) {
  let currentPayload: unknown;
  const terminal = (op: string) => {
    captured.push({ table, op, payload: currentPayload });
    return Promise.resolve(popResp(table));
  };

  const chain: Record<string, unknown> = {
    select: (_cols?: string, _opts?: Record<string, unknown>) => {
      // head:true is used with count queries — terminal.
      if (_opts && (_opts as { head?: boolean }).head) {
        // count query still needs .eq() chain before resolving; return chain that is
        // then-able after eq calls.
        const countChain = new Proxy(
          {},
          {
            get: (_t, prop) => {
              if (prop === "then") {
                const r = popResp(table);
                return (resolve: (v: Resp) => void) => resolve(r);
              }
              return () => countChain;
            },
          },
        );
        return countChain;
      }
      return chain;
    },
    insert: (payload: unknown) => {
      currentPayload = payload;
      captured.push({ table, op: "insert", payload });
      return chain;
    },
    update: (payload: unknown) => {
      currentPayload = payload;
      captured.push({ table, op: "update", payload });
      return chain;
    },
    upsert: (payload: unknown) => {
      captured.push({ table, op: "upsert", payload });
      return Promise.resolve(popResp(table));
    },
    delete: () => {
      captured.push({ table, op: "delete" });
      return chain;
    },
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    gte: () => chain,
    limit: () => chain,
    single: () => terminal("single"),
    maybeSingle: () => terminal("maybeSingle"),
    // When a query ends without .single() — e.g., `.select("id").eq(...)` alone —
    // the resolution happens via the awaited promise. Make chain thenable:
    then: (resolve: (v: Resp) => void) => resolve(popResp(table)),
  };
  return chain;
}

const supabaseMock = {
  from: (table: string) => makeQuery(table),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => supabaseMock,
}));

vi.mock("@/lib/utils/chat-context", () => ({
  invalidateOrgCaches: vi.fn(async () => {}),
}));

vi.mock("@/lib/utils/audit", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/investment-overview", () => ({
  generateInvestmentOverview: vi.fn(async (_db, _org, id) => ({
    overview: `Overview for ${id}`,
    skipped: false,
  })),
}));

// Import after mocks.
import { applyActions } from "../apply";

beforeEach(() => {
  for (const k of Object.keys(script)) delete script[k];
  captured.length = 0;
});

describe("apply.ts — investment investors", () => {
  it("add_investment_investor: inserts when no existing row", async () => {
    push("investment_investors", { data: null, error: null }); // maybeSingle (existing check)
    push("investment_investors", { data: { id: "ii-1" }, error: null }); // insert..single

    const { results } = await applyActions(
      [
        {
          action: "add_investment_investor",
          data: {
            investment_id: "11111111-1111-1111-1111-111111111111",
            entity_id: "22222222-2222-2222-2222-222222222222",
            committed_capital: 100000,
          },
        },
      ],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);
    expect((results[0].data as { investment_investor_id: string }).investment_investor_id).toBe("ii-1");
    expect(captured.some((c) => c.op === "insert" && c.table === "investment_investors")).toBe(true);
  });

  it("add_investment_investor: rejects if already active", async () => {
    push("investment_investors", {
      data: { id: "ii-existing", is_active: true },
      error: null,
    });

    const { results } = await applyActions(
      [
        {
          action: "add_investment_investor",
          data: {
            investment_id: "11111111-1111-1111-1111-111111111111",
            entity_id: "22222222-2222-2222-2222-222222222222",
          },
        },
      ],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe("already an investor");
  });

  it("add_investment_investor: reactivates inactive row", async () => {
    push("investment_investors", {
      data: { id: "ii-old", is_active: false, committed_capital: 50 },
      error: null,
    });
    push("investment_investors", { data: { id: "ii-old" }, error: null });

    const { results } = await applyActions(
      [
        {
          action: "add_investment_investor",
          data: {
            investment_id: "11111111-1111-1111-1111-111111111111",
            entity_id: "22222222-2222-2222-2222-222222222222",
            committed_capital: 200,
          },
        },
      ],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(true);
    const updateCall = captured.find((c) => c.op === "update" && c.table === "investment_investors");
    expect(updateCall).toBeDefined();
    expect((updateCall!.payload as { is_active: boolean }).is_active).toBe(true);
  });

  it("remove_investment_investor: refuses to remove last active investor", async () => {
    push("investment_investors", {
      data: { id: "ii-1", investment_id: "inv-1", entity_id: "e-1", is_active: true },
      error: null,
    });
    // Active-row count query returns only the target itself
    push("investment_investors", { data: [{ id: "ii-1" }], error: null });

    const { results } = await applyActions(
      [{ action: "remove_investment_investor", data: { investment_investor_id: "ii-1" } }],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/cannot remove last investor/);
  });
});

describe("apply.ts — ownership transfers", () => {
  const INV = "11111111-1111-1111-1111-111111111111";
  const FROM = "22222222-2222-2222-2222-222222222222";
  const TO = "33333333-3333-3333-3333-333333333333";

  function seedLookup(fromRow: Record<string, unknown> | null, toRow: Record<string, unknown> | null) {
    push("investments", { data: { id: INV, name: "909 Park" }, error: null }); // investment lookup
    push("entities", { data: [{ id: FROM, name: "Springvale LLC" }, { id: TO, name: "Oakmont Trust" }], error: null }); // entity name snapshots
    push("investment_investors", { data: fromRow, error: null }); // from active investor
  }

  it("record_ownership_transfer: moves capital points and pro-rata profit/committed to a NEW investor", async () => {
    seedLookup(
      { id: "ii-from", investment_id: INV, entity_id: FROM, capital_pct: 40, profit_pct: 50, committed_capital: 100000, is_active: true },
      null,
    );
    push("investment_investors", { data: null, error: null }); // from update (thenable)
    push("investment_investors", { data: null, error: null }); // to existing lookup → none
    push("investment_investors", { data: null, error: null }); // to insert (thenable)
    push("investment_ownership_transfers", { data: { id: "tr-1", transferred_pct: 10 }, error: null });

    const { results } = await applyActions(
      [{ action: "record_ownership_transfer", data: {
        investment_id: INV, from_entity_id: FROM, to_entity_id: TO,
        transfer_type: "gift", transferred_pct: 10,
      } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);

    // FROM: 40% → 30%; profit 50 → 37.5 (moved 12.5); committed 100000 → 75000.
    const fromUpdate = captured.find((c) => c.op === "update" && c.table === "investment_investors");
    const fp = fromUpdate!.payload as { capital_pct: number; profit_pct: number; committed_capital: number; is_active: boolean };
    expect(fp.capital_pct).toBe(30);
    expect(fp.profit_pct).toBe(37.5);
    expect(fp.committed_capital).toBe(75000);
    expect(fp.is_active).toBe(true);

    // TO (new investor): +10% capital, +12.5 profit, +25000 committed.
    const toInsert = captured.find((c) => c.op === "insert" && c.table === "investment_investors");
    const tp = toInsert!.payload as { capital_pct: number; profit_pct: number; committed_capital: number };
    expect(tp.capital_pct).toBe(10);
    expect(tp.profit_pct).toBe(12.5);
    expect(tp.committed_capital).toBe(25000);

    // Event row written with the name snapshots.
    const evt = captured.find((c) => c.op === "insert" && c.table === "investment_ownership_transfers");
    const ep = evt!.payload as { from_entity_name: string; to_entity_name: string; transferred_pct: number };
    expect(ep.from_entity_name).toBe("Springvale LLC");
    expect(ep.to_entity_name).toBe("Oakmont Trust");
    expect(ep.transferred_pct).toBe(10);
  });

  it("record_ownership_transfer: deactivates the giver on a full-stake transfer", async () => {
    seedLookup(
      { id: "ii-from", investment_id: INV, entity_id: FROM, capital_pct: 40, profit_pct: 40, committed_capital: 80000, is_active: true },
      null,
    );
    push("investment_investors", { data: null, error: null }); // from update
    push("investment_investors", { data: null, error: null }); // to existing lookup
    push("investment_investors", { data: null, error: null }); // to insert
    push("investment_ownership_transfers", { data: { id: "tr-2" }, error: null });

    const { results } = await applyActions(
      [{ action: "record_ownership_transfer", data: {
        investment_id: INV, from_entity_id: FROM, to_entity_id: TO,
        transfer_type: "sale", transferred_pct: 40,
      } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);
    const fromUpdate = captured.find((c) => c.op === "update" && c.table === "investment_investors");
    const fp = fromUpdate!.payload as { capital_pct: number; is_active: boolean };
    expect(fp.capital_pct).toBe(0);
    expect(fp.is_active).toBe(false);
  });

  it("record_ownership_transfer: rejects when the giver lacks enough stake", async () => {
    seedLookup(
      { id: "ii-from", investment_id: INV, entity_id: FROM, capital_pct: 5, profit_pct: 5, committed_capital: 1000, is_active: true },
      null,
    );

    const { results } = await applyActions(
      [{ action: "record_ownership_transfer", data: {
        investment_id: INV, from_entity_id: FROM, to_entity_id: TO,
        transfer_type: "gift", transferred_pct: 10,
      } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/cannot transfer/);
  });

  it("record_ownership_transfer: rejects when the giver is not an active investor", async () => {
    seedLookup(null, null); // from active lookup → none

    const { results } = await applyActions(
      [{ action: "record_ownership_transfer", data: {
        investment_id: INV, from_entity_id: FROM, to_entity_id: TO,
        transfer_type: "gift", transferred_pct: 10,
      } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/not an active investor/);
  });
});

describe("apply.ts — document entity links", () => {
  const DOC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const HOME = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const OTHER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("add_document_entity_link: upserts a junction row for an additional entity", async () => {
    push("documents", { data: { id: DOC, entity_id: HOME, name: "Gift Agreement" }, error: null });
    push("entities", { data: { id: OTHER, name: "Oakmont Trust" }, error: null });
    push("document_entity_links", { data: null, error: null }); // upsert

    const { results } = await applyActions(
      [{ action: "add_document_entity_link", data: { document_id: DOC, entity_id: OTHER } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);
    const upsert = captured.find((c) => c.op === "upsert" && c.table === "document_entity_links");
    expect(upsert).toBeDefined();
    const p = upsert!.payload as { entity_id: string; role: string; source: string };
    expect(p.entity_id).toBe(OTHER);
    expect(p.role).toBe("related");
    expect(p.source).toBe("manual");
  });

  it("add_document_entity_link: no-op when the entity is already the home", async () => {
    push("documents", { data: { id: DOC, entity_id: HOME, name: "Gift Agreement" }, error: null });
    push("entities", { data: { id: HOME, name: "Springvale LLC" }, error: null });

    const { results } = await applyActions(
      [{ action: "add_document_entity_link", data: { document_id: DOC, entity_id: HOME } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);
    expect((results[0].data as { already_primary: boolean }).already_primary).toBe(true);
    expect(captured.some((c) => c.op === "upsert" && c.table === "document_entity_links")).toBe(false);
  });

  it("remove_document_entity_link: deletes an additional association", async () => {
    push("documents", { data: { id: DOC, entity_id: HOME, name: "Gift Agreement" }, error: null });
    push("document_entity_links", { data: null, error: null }); // delete

    const { results } = await applyActions(
      [{ action: "remove_document_entity_link", data: { document_id: DOC, entity_id: OTHER } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(true);
    expect(captured.some((c) => c.op === "delete" && c.table === "document_entity_links")).toBe(true);
  });

  it("remove_document_entity_link: refuses to remove the home entity", async () => {
    push("documents", { data: { id: DOC, entity_id: HOME, name: "Gift Agreement" }, error: null });

    const { results } = await applyActions(
      [{ action: "remove_document_entity_link", data: { document_id: DOC, entity_id: HOME } }],
      { orgId: "org-1", userId: "user-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/home \(primary\) entity/);
  });
});

describe("apply.ts — investment overview", () => {
  it("refresh_investment_overview: regenerates and returns the overview", async () => {
    const INV = "11111111-1111-1111-1111-111111111111";
    const { results } = await applyActions(
      [{ action: "refresh_investment_overview", data: { investment_id: INV } }],
      { orgId: "org-1", userId: "user-1" },
    );
    expect(results[0].success).toBe(true);
    expect((results[0].data as { overview: string }).overview).toBe(`Overview for ${INV}`);
  });
});

describe("apply.ts — documents", () => {
  it("archive_document: sets deleted_at", async () => {
    push("documents", {
      data: { id: "doc-1", entity_id: "e-1", investment_id: null, deleted_at: null },
      error: null,
    });
    push("documents", { data: { id: "doc-1", deleted_at: "2026-04-15T00:00:00Z" }, error: null });

    const { results } = await applyActions(
      [{ action: "archive_document", data: { document_id: "doc-1" } }],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(true);
    const updateCall = captured.find((c) => c.op === "update" && c.table === "documents");
    expect(updateCall).toBeDefined();
    expect((updateCall!.payload as { deleted_at: string }).deleted_at).toBeTruthy();
  });

  it("unlink_document: nulls entity_id only when scope=entity", async () => {
    push("documents", {
      data: { id: "doc-1", entity_id: "e-1", investment_id: "inv-1" },
      error: null,
    });
    push("documents", { data: { id: "doc-1", entity_id: null, investment_id: "inv-1" }, error: null });

    const { results } = await applyActions(
      [{ action: "unlink_document", data: { document_id: "doc-1", scope: "entity" } }],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(true);
    const updateCall = captured.find((c) => c.op === "update" && c.table === "documents");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.payload as Record<string, unknown>;
    expect(payload.entity_id).toBeNull();
    expect("investment_id" in payload).toBe(false);
  });

  // split_document moved to the MCP tool layer (splitDocumentTool in
  // tools/documents-write.ts); apply.ts treats any stale staged action with
  // this name as unknown.
  it("split_document: rejected as an unknown pipeline action", async () => {
    const { results } = await applyActions(
      [{ action: "split_document", data: { document_id: "doc-1" } }],
      { orgId: "org-1" },
    );
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/Unknown action: split_document/);
  });
});

describe("apply.ts — co-investors & compliance", () => {
  it("add_co_investor: happy path insert", async () => {
    push("investment_co_investors", {
      data: { id: "ci-1", role: "co_investor", investment_id: "inv-1" },
      error: null,
    });

    const { results } = await applyActions(
      [
        {
          action: "add_co_investor",
          data: {
            investment_id: "11111111-1111-1111-1111-111111111111",
            directory_entry_id: "d-1",
            role: "co_investor",
            capital_pct: 10,
          },
        },
      ],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(true);
    expect(captured.some((c) => c.op === "insert" && c.table === "investment_co_investors")).toBe(true);
  });

  it("remove_co_investor: validation failure when id missing", async () => {
    const { results } = await applyActions(
      [{ action: "remove_co_investor", data: {} }],
      { orgId: "org-1" },
    );
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/co_investor_id is required/);
  });

  it("create_compliance_obligation: requires name and due_date", async () => {
    const { results } = await applyActions(
      [
        {
          action: "create_compliance_obligation",
          data: { entity_id: "11111111-1111-1111-1111-111111111111", name: "" },
        },
      ],
      { orgId: "org-1" },
    );
    expect(results[0].success).toBe(false);
  });
});

describe("apply.ts — archive_directory_entry", () => {
  it("refuses when active references exist", async () => {
    // investment_allocations count
    push("investment_allocations", { data: null, error: null, count: 2 });
    push("investment_co_investors", { data: null, error: null, count: 0 });
    push("entity_members", { data: null, error: null, count: 0 });

    const { results } = await applyActions(
      [{ action: "archive_directory_entry", data: { directory_entry_id: "d-1" } }],
      { orgId: "org-1" },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/still referenced/);
  });
});
