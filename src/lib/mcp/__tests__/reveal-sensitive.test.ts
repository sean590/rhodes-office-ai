import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";

// --- Mock logAuditEvent so logSensitiveReveal calls are captured -----------

const auditCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/utils/audit", () => ({
  logAuditEvent: async (event: Record<string, unknown>) => {
    auditCalls.push(event);
  },
}));

// Import after mocks.
import { getEntityTool, getEntityMembersTool } from "../tools/entities";
import { getDirectoryEntryTool } from "../tools/directory";
import { redact } from "../redact";

// --- Supabase recording client -----------------------------------------------

function makeClient(
  script: Record<string, Array<{ data?: unknown; error?: unknown; count?: number }>>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (table: string): any => {
    const popResp = () => {
      const queue = script[table] ?? [];
      return queue.shift() ?? { data: [], error: null };
    };
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
    chain.single = () => Promise.resolve(popResp());
    chain.maybeSingle = () => Promise.resolve(popResp());
    chain.then = (resolve: (v: unknown) => unknown) => resolve(popResp());
    return chain;
  };
}

function makeCtx(
  orgId: string,
  script: Record<string, Array<{ data?: unknown; error?: unknown; count?: number }>>,
): ToolContext {
  return {
    userId: "u-1",
    orgId,
    orgRole: "owner",
    sessionId: "s-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: makeClient(script) } as any,
    redact,
  };
}

beforeEach(() => {
  auditCalls.length = 0;
});

// --- Helper: an entity row with sensitive fields ----------------------------

const entityRow = {
  id: "e-1",
  name: "Acme LLC",
  ein: "12-3456789",
  tax_id: "SECRET-TAX-ID",
  ssn: null,
};

const directoryRow = {
  id: "d-1",
  name: "John Doe",
  ein: "12-3456789",
  tax_id: "SECRET",
  ssn: "111-22-3333",
  bank_account_number: "9876543210",
  routing_number: "021000021",
  date_of_birth: "1985-06-15",
  home_address: "123 Main St",
  driver_license_number: "D1234567",
  passport_number: "P987654321",
};

const memberRow = {
  id: "m-1",
  name: "Member A",
  ssn: "222-33-4444",
  date_of_birth: "1990-01-01",
  home_address: "456 Oak Ave",
};

// =============================================================================
// get_entity
// =============================================================================

describe("get_entity — reveal_sensitive", () => {
  function entityScript() {
    return {
      entities: [
        { data: { id: "e-1" }, error: null }, // ownership check
        { data: entityRow, error: null },      // actual select
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
    };
  }

  it("without reveal: ein is masked, tax_id is redacted", async () => {
    const ctx = makeCtx("org-A", entityScript());
    const result = await getEntityTool.handler(
      { entity_id: "e-1", reveal_sensitive: false },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.ein).toBe("XX-XXX6789");
    expect(d.tax_id).toBe("[REDACTED]");
    expect(auditCalls).toHaveLength(0);
  });

  it("with reveal: ein and tax_id are unredacted; audit log fires", async () => {
    const ctx = makeCtx("org-A", entityScript());
    const result = await getEntityTool.handler(
      { entity_id: "e-1", reveal_sensitive: true },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.ein).toBe("12-3456789");
    expect(d.tax_id).toBe("SECRET-TAX-ID");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("sensitive_reveal");
    expect(auditCalls[0].resourceType).toBe("entity");
    expect((auditCalls[0].metadata as { fields_revealed: string[] }).fields_revealed).toEqual([
      "ein",
      "tax_id",
    ]);
  });
});

// =============================================================================
// get_directory_entry
// =============================================================================

describe("get_directory_entry — reveal_sensitive", () => {
  function directoryScript() {
    return {
      directory_entries: [{ data: directoryRow, error: null }],
      entity_members: [{ data: null, error: null, count: 0 }],
      entity_managers: [{ data: null, error: null, count: 0 }],
      cap_table_entries: [{ data: null, error: null, count: 0 }],
      investment_co_investors: [{ data: null, error: null, count: 0 }],
      investment_allocations: [{ data: null, error: null, count: 0 }],
      relationships: [
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 0 },
      ],
    };
  }

  it("without reveal: all 9 catalog fields are redacted", async () => {
    const ctx = makeCtx("org-A", directoryScript());
    const result = await getDirectoryEntryTool.handler(
      { directory_entry_id: "d-1", reveal_sensitive: false },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.ein).toBe("XX-XXX6789");
    expect(d.tax_id).toBe("[REDACTED]");
    expect(d.ssn).toBe("[REDACTED]");
    expect(d.bank_account_number).toBe("[REDACTED]");
    expect(d.routing_number).toBe("[REDACTED]");
    expect(d.date_of_birth).toBe("[REDACTED]");
    expect(d.home_address).toBe("[REDACTED]");
    expect(d.driver_license_number).toBe("[REDACTED]");
    expect(d.passport_number).toBe("[REDACTED]");
    expect(auditCalls).toHaveLength(0);
  });

  it("with reveal: all 9 fields are unredacted; audit log fires", async () => {
    const ctx = makeCtx("org-A", directoryScript());
    const result = await getDirectoryEntryTool.handler(
      { directory_entry_id: "d-1", reveal_sensitive: true },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.ein).toBe("12-3456789");
    expect(d.ssn).toBe("111-22-3333");
    expect(d.bank_account_number).toBe("9876543210");
    expect(d.routing_number).toBe("021000021");
    expect(d.date_of_birth).toBe("1985-06-15");
    expect(d.home_address).toBe("123 Main St");
    expect(d.driver_license_number).toBe("D1234567");
    expect(d.passport_number).toBe("P987654321");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("sensitive_reveal");
    expect(
      (auditCalls[0].metadata as { fields_revealed: string[] }).fields_revealed,
    ).toHaveLength(9);
  });
});

// =============================================================================
// get_entity_members
// =============================================================================

describe("get_entity_members — reveal_sensitive", () => {
  function membersScript() {
    return {
      entities: [{ data: { id: "e-1" }, error: null }], // ownership
      entity_members: [{ data: [memberRow], error: null }],
      entity_managers: [{ data: [], error: null }],
    };
  }

  it("without reveal: ssn, date_of_birth, home_address are redacted", async () => {
    const ctx = makeCtx("org-A", membersScript());
    const result = await getEntityMembersTool.handler(
      { entity_id: "e-1", reveal_sensitive: false },
      ctx,
    );
    const members = (result.data as { members: Array<Record<string, unknown>> }).members;
    expect(members[0].ssn).toBe("[REDACTED]");
    expect(members[0].date_of_birth).toBe("[REDACTED]");
    expect(members[0].home_address).toBe("[REDACTED]");
    expect(auditCalls).toHaveLength(0);
  });

  it("with reveal: those 3 fields unredacted; audit log fires", async () => {
    const ctx = makeCtx("org-A", membersScript());
    const result = await getEntityMembersTool.handler(
      { entity_id: "e-1", reveal_sensitive: true },
      ctx,
    );
    const members = (result.data as { members: Array<Record<string, unknown>> }).members;
    expect(members[0].ssn).toBe("222-33-4444");
    expect(members[0].date_of_birth).toBe("1990-01-01");
    expect(members[0].home_address).toBe("456 Oak Ave");
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0].metadata as { fields_revealed: string[] }).fields_revealed).toEqual([
      "ssn",
      "date_of_birth",
      "home_address",
    ]);
  });
});

// =============================================================================
// Cross-org: ownership check fires BEFORE reveal
// =============================================================================

describe("reveal — cross-org gate fires before reveal logic", () => {
  it("get_entity with reveal_sensitive + wrong-org entity → not_found, no audit", async () => {
    const ctx = makeCtx("org-A", {
      entities: [{ data: null, error: null }], // ownership fails
    });
    await expect(
      getEntityTool.handler({ entity_id: "e-other", reveal_sensitive: true }, ctx),
    ).rejects.toThrow(/not found/);
    expect(auditCalls).toHaveLength(0);
  });
});
