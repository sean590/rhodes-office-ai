/**
 * Functional smoke tests for the compliance-obligation write tools.
 *
 * Verifies dispatch routing for the three compliance writes that previously
 * only had cross-org ownership coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";
import type { ToolDefinition } from "../schema";

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

import { entityWriteTools } from "../tools/entities-write";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const OBLIGATION_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";

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

function tool(name: string): ToolDefinition {
  const t = entityWriteTools.find((tt) => tt.name === name);
  if (!t) throw new Error(`tool ${name} not found in entityWriteTools`);
  return t;
}

beforeEach(() => {
  dispatchMock.mockReset().mockResolvedValue({
    data: { id: "stub-id" },
    audit_event_id: "audit-1",
  });
  ownershipMock.mockReset().mockResolvedValue(undefined);
  resolveNameMock.mockReset().mockResolvedValue("DE Annual Report");
});

// ═══════════════════════════════════════════════════════════════════

describe("create_compliance_obligation", () => {
  it("dispatches create_compliance_obligation with rule_id / jurisdiction / due_date", async () => {
    await tool("create_compliance_obligation").handler(
      {
        entity_id: ENTITY_ID,
        rule_id: "de_annual_report",
        name: "DE Annual Report 2025",
        obligation_type: "annual_report",
        jurisdiction: "DE",
        due_date: "2026-06-01",
        recurrence: "annual",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_compliance_obligation",
      expect.objectContaining({
        rule_id: "de_annual_report",
        jurisdiction: "DE",
        due_date: "2026-06-01",
      }),
    );
  });

  it("dryRun includes obligation type, jurisdiction, due date, and entity name", async () => {
    resolveNameMock.mockResolvedValueOnce("DG24 LLC");
    const result = await tool("create_compliance_obligation").dryRun!(
      {
        entity_id: ENTITY_ID,
        name: "Test Filing",
        obligation_type: "annual_report",
        jurisdiction: "DE",
        due_date: "2026-06-01",
        source: "ai",
      },
      makeCtx(),
    );
    expect(result.summary).toContain("annual_report");
    expect(result.summary).toContain("DE");
    expect(result.summary).toContain("2026-06-01");
    expect(result.summary).toContain("DG24 LLC");
  });
});

describe("update_compliance_obligation", () => {
  it("dispatches update_compliance_obligation with obligation_id + fields", async () => {
    await tool("update_compliance_obligation").handler(
      {
        obligation_id: OBLIGATION_ID,
        due_date: "2026-07-01",
        notes: "Extension granted",
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_compliance_obligation",
      expect.objectContaining({
        obligation_id: OBLIGATION_ID,
        due_date: "2026-07-01",
        notes: "Extension granted",
      }),
    );
  });
});

describe("mark_obligation_complete", () => {
  it("dispatches complete_obligation with obligation_id + payment details", async () => {
    await tool("mark_obligation_complete").handler(
      {
        obligation_id: OBLIGATION_ID,
        completed_at: "2025-05-20",
        payment_amount: 300,
        confirmation: "CONF-12345",
        document_id: DOCUMENT_ID,
      },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "complete_obligation",
      expect.objectContaining({
        obligation_id: OBLIGATION_ID,
        completed_at: "2025-05-20",
        payment_amount: 300,
        confirmation: "CONF-12345",
        document_id: DOCUMENT_ID,
      }),
    );
  });

  it("dryRun returns 'Complete obligation \"{name}\"'", async () => {
    resolveNameMock.mockResolvedValueOnce("DE Annual Report");
    const result = await tool("mark_obligation_complete").dryRun!(
      { obligation_id: OBLIGATION_ID },
      makeCtx(),
    );
    expect(result.summary).toBe('Complete obligation "DE Annual Report"');
  });
});
