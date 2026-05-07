/**
 * Functional smoke tests for investment-domain MCP write tools.
 *
 * Verifies each handler dispatches the right apply.ts action with the
 * expected payload. update_investment and archive_investment both route
 * through update_entity — that quirk is verified here.
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

import {
  createInvestmentTool,
  updateInvestmentTool,
  archiveInvestmentTool,
  addInvestmentInvestorTool,
  updateInvestmentInvestorTool,
  removeInvestmentInvestorTool,
  addCoInvestorTool,
  updateCoInvestorTool,
  removeCoInvestorTool,
  recordInvestmentTransactionTool,
  updateInvestmentTransactionTool,
  deleteInvestmentTransactionTool,
  setInvestmentAllocationsTool,
} from "../tools/investments-write";

const INVESTMENT_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const INVESTOR_ID = "33333333-3333-4333-8333-333333333333";
const CO_INVESTOR_ID = "44444444-4444-4444-8444-444444444444";
const TRANSACTION_ID = "55555555-5555-4555-8555-555555555555";
const DIRECTORY_ID = "66666666-6666-4666-8666-666666666666";
const ORG_ID = "77777777-7777-4777-8777-777777777777";

function makeCtx(): ToolContext {
  return {
    userId: "user-1",
    orgId: ORG_ID,
    sessionId: "sess-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    redact: (o) => o,
  };
}

beforeEach(() => {
  dispatchMock.mockReset().mockResolvedValue({
    data: { id: "stub-id" },
    audit_event_id: "audit-1",
  });
  ownershipMock.mockReset().mockResolvedValue(undefined);
  resolveNameMock.mockReset().mockResolvedValue("Test Investment");
});

// ═══════════════════════════════════════════════════════════════════

describe("investment lifecycle — dispatch routing", () => {
  it("create_investment dispatches create_investment", async () => {
    await createInvestmentTool.handler(
      {
        name: "Rhodes Fund I",
        investment_type: "fund",
        parent_entity_id: ENTITY_ID,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_investment",
      expect.objectContaining({ name: "Rhodes Fund I", investment_type: "fund" }),
    );
  });

  it("update_investment dispatches update_entity (investments share the entities table)", async () => {
    await updateInvestmentTool.handler(
      {
        investment_id: INVESTMENT_ID,
        name: "Renamed Fund",
        investment_type: "fund",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_entity",
      expect.objectContaining({
        entity_id: INVESTMENT_ID,
        name: "Renamed Fund",
      }),
    );
  });

  it("archive_investment dispatches update_entity with status=exited", async () => {
    await archiveInvestmentTool.handler({ investment_id: INVESTMENT_ID }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_entity",
      expect.objectContaining({ entity_id: INVESTMENT_ID, status: "exited" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════

describe("investors — dispatch routing", () => {
  it("add_investment_investor dispatches add_investment_investor", async () => {
    await addInvestmentInvestorTool.handler(
      {
        investment_id: INVESTMENT_ID,
        entity_id: ENTITY_ID,
        committed_capital: 1_000_000,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_investment_investor",
      expect.objectContaining({
        investment_id: INVESTMENT_ID,
        entity_id: ENTITY_ID,
      }),
    );
  });

  it("update_investment_investor dispatches update_investment_investor", async () => {
    await updateInvestmentInvestorTool.handler(
      { investment_investor_id: INVESTOR_ID, committed_capital: 2_000_000 },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_investment_investor",
      expect.objectContaining({ committed_capital: 2_000_000 }),
    );
  });

  it("remove_investment_investor dispatches remove_investment_investor", async () => {
    await removeInvestmentInvestorTool.handler(
      { investment_investor_id: INVESTOR_ID },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "remove_investment_investor",
      expect.objectContaining({ investment_investor_id: INVESTOR_ID }),
    );
  });
});

describe("co-investors — dispatch routing", () => {
  it("add_co_investor dispatches add_co_investor", async () => {
    await addCoInvestorTool.handler(
      {
        investment_id: INVESTMENT_ID,
        directory_entry_id: DIRECTORY_ID,
        role: "co_investor",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "add_co_investor",
      expect.objectContaining({
        investment_id: INVESTMENT_ID,
        directory_entry_id: DIRECTORY_ID,
      }),
    );
  });

  it("update_co_investor dispatches update_co_investor", async () => {
    await updateCoInvestorTool.handler(
      { co_investor_id: CO_INVESTOR_ID, role: "promoter" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_co_investor",
      expect.objectContaining({ co_investor_id: CO_INVESTOR_ID, role: "promoter" }),
    );
  });

  it("remove_co_investor dispatches remove_co_investor", async () => {
    await removeCoInvestorTool.handler({ co_investor_id: CO_INVESTOR_ID }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "remove_co_investor",
      expect.objectContaining({ co_investor_id: CO_INVESTOR_ID }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════

describe("transactions — dispatch routing", () => {
  it("record_investment_transaction dispatches record_investment_transaction", async () => {
    await recordInvestmentTransactionTool.handler(
      {
        investment_id: INVESTMENT_ID,
        transaction_type: "contribution",
        amount: 500_000,
        transaction_date: "2025-01-15",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "record_investment_transaction",
      expect.objectContaining({
        transaction_type: "contribution",
        amount: 500_000,
      }),
    );
  });

  it("record_investment_transaction dryRun summarizes the contribution", async () => {
    resolveNameMock.mockResolvedValueOnce("Rhodes Fund I");
    const result = await recordInvestmentTransactionTool.dryRun!(
      {
        investment_id: INVESTMENT_ID,
        transaction_type: "contribution",
        amount: 500_000,
        transaction_date: "2025-01-15",
      },
      makeCtx(),
    );
    expect(result.summary).toContain("contribution");
    expect(result.summary).toContain("$500,000");
    expect(result.summary).toContain("Rhodes Fund I");
    expect(result.summary).toContain("2025-01-15");
  });

  it("update_investment_transaction dispatches update_investment_transaction", async () => {
    await updateInvestmentTransactionTool.handler(
      { transaction_id: TRANSACTION_ID, amount: 600_000 },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_investment_transaction",
      expect.objectContaining({ transaction_id: TRANSACTION_ID, amount: 600_000 }),
    );
  });

  it("delete_investment_transaction dispatches delete_investment_transaction", async () => {
    await deleteInvestmentTransactionTool.handler(
      { transaction_id: TRANSACTION_ID },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "delete_investment_transaction",
      expect.objectContaining({ transaction_id: TRANSACTION_ID }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════

describe("allocations — dispatch routing", () => {
  it("set_investment_allocations dispatches set_investment_allocations with array", async () => {
    await setInvestmentAllocationsTool.handler(
      {
        investment_id: INVESTMENT_ID,
        parent_entity_id: ENTITY_ID,
        allocations: [
          { member_name: "Alice", allocation_pct: 60 },
          { member_name: "Bob", allocation_pct: 40 },
        ],
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "set_investment_allocations",
      expect.objectContaining({
        investment_id: INVESTMENT_ID,
        allocations: expect.arrayContaining([
          expect.objectContaining({ member_name: "Alice", allocation_pct: 60 }),
        ]),
      }),
    );
  });

  it("set_investment_allocations dryRun includes the total percentage", async () => {
    resolveNameMock.mockResolvedValueOnce("Rhodes Fund I");
    const result = await setInvestmentAllocationsTool.dryRun!(
      {
        investment_id: INVESTMENT_ID,
        parent_entity_id: ENTITY_ID,
        allocations: [
          { member_name: "Alice", allocation_pct: 60 },
          { member_name: "Bob", allocation_pct: 40 },
        ],
      },
      makeCtx(),
    );
    expect(result.summary).toContain("2 allocations");
    expect(result.summary).toContain("100%");
    expect(result.summary).toContain("Rhodes Fund I");
  });
});
