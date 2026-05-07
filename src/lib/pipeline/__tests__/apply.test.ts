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

  it("split_document: returns staged/not-implemented error", async () => {
    const { results } = await applyActions(
      [{ action: "split_document", data: { document_id: "doc-1" } }],
      { orgId: "org-1" },
    );
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/not yet implemented/);
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
