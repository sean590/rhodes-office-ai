/**
 * Functional smoke tests for entity-domain MCP tools.
 *
 * These verify that each tool handler calls dispatchAction with the correct
 * action name and payload. We don't test that the DB actually mutates — that's
 * apply.ts's job and has its own coverage. dryRun summaries are spot-checked
 * for representative tools to ensure approval cards read naturally.
 *
 * Pattern: vi.mock dispatchAction + verifyResourceOwnership + resolveName
 * so handlers proceed past their ownership gates and the dispatch surface is
 * inspectable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";

// ── Mocks ──────────────────────────────────────────────────────────

const dispatchMock = vi.fn();
vi.mock("@/lib/mcp/apply-dispatch", () => ({
  dispatchAction: (...args: unknown[]) => dispatchMock(...args),
}));

const ownershipMock = vi.fn();
vi.mock("@/lib/mcp/ownership", () => ({
  verifyResourceOwnership: (...args: unknown[]) => ownershipMock(...args),
}));

const resolveNameMock = vi.fn();
vi.mock("@/lib/mcp/resolve-names", () => ({
  resolveName: (...args: unknown[]) => resolveNameMock(...args),
}));

// ── Tool imports (must come after mocks) ──────────────────────────

import {
  createEntityTool,
  updateEntityTool,
  archiveEntityTool,
  changeEntityStatusTool,
} from "../tools/entities-write";
// Entity-write exports are named inline via factory for members/managers/etc.
// Import the whole module to pick them off the registry by name.
import { entityWriteTools } from "../tools/entities-write";
import { entityTools } from "../tools/entities";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

type DbScript = Record<string, Array<{ data?: unknown; error?: unknown }>>;
let currentDb: DbScript = {};

function setDb(db: DbScript) {
  currentDb = db;
}

function makeSupabase() {
  const db = () => currentDb;
  const makeChain = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const pass = () => chain;
    chain.select = pass;
    chain.eq = pass;
    chain.neq = pass;
    chain.in = pass;
    chain.is = pass;
    chain.not = pass;
    chain.lt = pass;
    chain.lte = pass;
    chain.gte = pass;
    chain.ilike = pass;
    chain.order = pass;
    chain.limit = pass;

    const consume = () => {
      const queue = db()[table] ?? [];
      return queue.shift() ?? { data: [], error: null };
    };
    chain.single = () => Promise.resolve(consume());
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(consume());
    return chain;
  };
  return { from: (table: string) => makeChain(table) };
}

function makeCtx(): ToolContext {
  return {
    userId: "user-1",
    orgId: ORG_ID,
    orgRole: "owner",
    sessionId: "sess-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeSupabase() as any,
    redact: (o) => o,
  };
}

beforeEach(() => {
  setDb({});
  dispatchMock.mockReset().mockResolvedValue({
    data: { id: "stub-id" },
    audit_event_id: "audit-1",
  });
  ownershipMock.mockReset().mockResolvedValue(undefined);
  resolveNameMock.mockReset().mockResolvedValue("Test Entity");
});

function toolByName(name: string) {
  const t = entityWriteTools.find((tt) => tt.name === name);
  if (!t) throw new Error(`tool ${name} not found in entityWriteTools`);
  return t;
}

function readToolByName(name: string) {
  const t = entityTools.find((tt) => tt.name === name);
  if (!t) throw new Error(`tool ${name} not found in entityTools`);
  return t;
}

// ═══════════════════════════════════════════════════════════════════
// Read: get_entity_registrations
// ═══════════════════════════════════════════════════════════════════

describe("get_entity_registrations (read)", () => {
  const tool = readToolByName("get_entity_registrations");

  it("returns registrations with state_ids merged in", async () => {
    setDb({
      // verifyEntityBelongsToOrg check
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_registrations: [
        {
          data: [
            { id: "r1", entity_id: ENTITY_ID, jurisdiction: "DE", qualification_date: "2020-01-01" },
          ],
          error: null,
        },
      ],
      entity_state_ids: [
        {
          data: [
            { id: "sid1", entity_id: ENTITY_ID, jurisdiction: "DE", state_id_number: "1234567" },
          ],
          error: null,
        },
      ],
    });

    const result = await tool.handler({ entity_id: ENTITY_ID }, makeCtx());
    const d = result.data as { registrations: Array<Record<string, unknown>>; orphan_state_ids: unknown[] };
    expect(Array.isArray(d.registrations)).toBe(true);
    expect(d.registrations).toHaveLength(1);
    expect(d.registrations[0].jurisdiction).toBe("DE");
  });

  it("returns an empty list for an entity with no registrations", async () => {
    setDb({
      entities: [{ data: { id: ENTITY_ID }, error: null }],
      entity_registrations: [{ data: [], error: null }],
      entity_state_ids: [{ data: [], error: null }],
    });
    const result = await tool.handler({ entity_id: ENTITY_ID }, makeCtx());
    const d = result.data as { registrations: unknown[] };
    expect(d.registrations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: core entity lifecycle
// ═══════════════════════════════════════════════════════════════════

describe("entity write tools — dispatch routing", () => {
  it("create_entity dispatches create_entity with the input", async () => {
    const ctx = makeCtx();
    await createEntityTool.handler(
      {
        name: "Test LLC",
        type: "operating_company",
        formation_state: "DE",
      },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "create_entity", {
      name: "Test LLC",
      type: "operating_company",
      formation_state: "DE",
    });
  });

  it("create_entity dryRun returns 'Create entity: {name} ({type})'", async () => {
    const result = await createEntityTool.dryRun!(
      { name: "Acme LLC", type: "operating_company" },
      makeCtx(),
    );
    expect(result.summary).toBe("Create entity: Acme LLC (operating_company)");
  });

  it("update_entity dispatches update_entity with entity_id + fields", async () => {
    const ctx = makeCtx();
    await updateEntityTool.handler(
      { entity_id: ENTITY_ID, fields: { ein: "12-3456789" } },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "update_entity", {
      entity_id: ENTITY_ID,
      fields: { ein: "12-3456789" },
    });
  });

  it("archive_entity dispatches update_entity with status=inactive", async () => {
    const ctx = makeCtx();
    await archiveEntityTool.handler({ entity_id: ENTITY_ID }, ctx);
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "update_entity", {
      entity_id: ENTITY_ID,
      status: "inactive",
    });
  });

  it("archive_entity dryRun returns archive summary", async () => {
    resolveNameMock.mockResolvedValueOnce("Acme LLC");
    const result = await archiveEntityTool.dryRun!({ entity_id: ENTITY_ID }, makeCtx());
    expect(result.summary).toBe("Archive Acme LLC (set status to inactive)");
  });

  it("change_entity_status dispatches update_entity with status in fields", async () => {
    // dryRun fetches current status + counts; handler just dispatches
    const ctx = makeCtx();
    await changeEntityStatusTool.handler(
      { entity_id: ENTITY_ID, status: "dissolved" },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "update_entity", {
      entity_id: ENTITY_ID,
      fields: { status: "dissolved" },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: members / managers / cap table
// ═══════════════════════════════════════════════════════════════════

describe("entity people + cap table — dispatch routing", () => {
  it("add_entity_member dispatches add_member", async () => {
    const tool = toolByName("add_entity_member");
    await tool.handler(
      {
        entity_id: ENTITY_ID,
        investor_name: "Alice",
        investor_type: "individual",
        ownership_pct: 50,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(expect.anything(), "add_member", expect.any(Object));
  });

  it("update_entity_member dispatches update_cap_table", async () => {
    const tool = toolByName("update_entity_member");
    await tool.handler(
      {
        entity_id: ENTITY_ID,
        investor_name: "Alice",
        investor_type: "individual",
        ownership_pct: 25,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_cap_table",
      expect.objectContaining({ investor_name: "Alice", ownership_pct: 25 }),
    );
  });

  it("add_entity_manager dispatches add_manager", async () => {
    const tool = toolByName("add_entity_manager");
    await tool.handler({ entity_id: ENTITY_ID, name: "Bob" }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_manager",
      expect.objectContaining({ name: "Bob" }),
    );
  });

  it("set_cap_table_entries dispatches update_cap_table", async () => {
    const tool = toolByName("set_cap_table_entries");
    await tool.handler(
      {
        entity_id: ENTITY_ID,
        investor_name: "Alice",
        investor_type: "individual",
        ownership_pct: 50,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_cap_table",
      expect.objectContaining({ investor_name: "Alice", ownership_pct: 50 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: relationships
// ═══════════════════════════════════════════════════════════════════

describe("relationship tools — dispatch routing", () => {
  it("create_relationship dispatches create_relationship", async () => {
    const tool = toolByName("create_relationship");
    await tool.handler(
      {
        from_entity_id: ENTITY_ID,
        to_entity_id: "33333333-3333-4333-8333-333333333333",
        type: "other",
        description: "affiliate",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_relationship",
      expect.objectContaining({ description: "affiliate" }),
    );
  });

  it("update_relationship dispatches create_relationship (upsert path)", async () => {
    const tool = toolByName("update_relationship");
    await tool.handler(
      {
        from_entity_id: ENTITY_ID,
        to_entity_id: "33333333-3333-4333-8333-333333333333",
        type: "other",
        description: "updated",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_relationship",
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: state IDs
// ═══════════════════════════════════════════════════════════════════

describe("state ID tool — dispatch routing", () => {
  it("upsert_state_id dispatches upsert_state_id with jurisdiction + number", async () => {
    const tool = toolByName("upsert_state_id");
    await tool.handler(
      {
        entity_id: ENTITY_ID,
        jurisdiction: "DE",
        state_id_number: "1234567",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "upsert_state_id",
      expect.objectContaining({
        entity_id: ENTITY_ID,
        jurisdiction: "DE",
        state_id_number: "1234567",
        label: "Entity Number",
      }),
    );
  });

  it("upsert_state_id dryRun renders state name via getStateLabel", async () => {
    resolveNameMock.mockResolvedValueOnce("Acme LLC");
    const tool = toolByName("upsert_state_id");
    const result = await tool.dryRun!(
      {
        entity_id: ENTITY_ID,
        jurisdiction: "DE",
        state_id_number: "1234567",
      },
      makeCtx(),
    );
    expect(result.summary).toBe("Set Delaware state ID for Acme LLC to 1234567");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: new tools from MCP parity PRs
// ═══════════════════════════════════════════════════════════════════

describe("trust + partnership-rep tools — dispatch routing", () => {
  it("update_trust_details dispatches update_trust_details", async () => {
    const tool = toolByName("update_trust_details");
    await tool.handler(
      { entity_id: ENTITY_ID, trust_type: "revocable", situs_state: "DE" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_trust_details",
      expect.objectContaining({ trust_type: "revocable" }),
    );
  });

  it("add_entity_role dispatches add_role", async () => {
    const tool = toolByName("add_entity_role");
    await tool.handler(
      { entity_id: ENTITY_ID, role_title: "trustee", name: "Jane Smith" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_role",
      expect.objectContaining({ role_title: "trustee", name: "Jane Smith" }),
    );
  });

  it("remove_entity_role dispatches remove_role", async () => {
    const tool = toolByName("remove_entity_role");
    const roleId = "99999999-9999-4999-8999-999999999999";
    await tool.handler({ entity_id: ENTITY_ID, role_id: roleId }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "remove_role",
      expect.objectContaining({ role_id: roleId }),
    );
  });

  it("add_partnership_rep dispatches add_partnership_rep", async () => {
    const tool = toolByName("add_partnership_rep");
    await tool.handler({ entity_id: ENTITY_ID, name: "Bob" }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_partnership_rep",
      expect.objectContaining({ name: "Bob" }),
    );
  });
});

describe("custom field + registration tools — dispatch routing", () => {
  it("set_custom_field dispatches set_custom_field (upsert)", async () => {
    const tool = toolByName("set_custom_field");
    await tool.handler(
      { entity_id: ENTITY_ID, label: "Fiscal Year End", value: "December 31" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "set_custom_field",
      expect.objectContaining({ label: "Fiscal Year End", value: "December 31" }),
    );
  });

  it("remove_custom_field dispatches remove_custom_field", async () => {
    const tool = toolByName("remove_custom_field");
    await tool.handler({ entity_id: ENTITY_ID, label: "Fiscal Year End" }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "remove_custom_field",
      expect.objectContaining({ label: "Fiscal Year End" }),
    );
  });

  it("create_registration dispatches add_registration", async () => {
    const tool = toolByName("create_registration");
    await tool.handler(
      { entity_id: ENTITY_ID, jurisdiction: "DE" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_registration",
      expect.objectContaining({ jurisdiction: "DE" }),
    );
  });

  it("update_registration dispatches update_registration", async () => {
    const tool = toolByName("update_registration");
    const regId = "88888888-8888-4888-8888-888888888888";
    await tool.handler(
      {
        entity_id: ENTITY_ID,
        registration_id: regId,
        last_filing_date: "2025-01-15",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_registration",
      expect.objectContaining({ registration_id: regId, last_filing_date: "2025-01-15" }),
    );
  });
});
