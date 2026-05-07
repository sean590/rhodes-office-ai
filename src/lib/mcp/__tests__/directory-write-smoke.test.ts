/**
 * Functional smoke tests for directory write tools.
 *
 * Verifies dispatch routing for create/update/archive directory entries.
 * Note: update_directory_entry currently reuses the create_directory_entry
 * apply action as an upsert — that quirk is asserted here.
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
  createDirectoryEntryTool,
  updateDirectoryEntryTool,
  archiveDirectoryEntryTool,
} from "../tools/directory-write";

const DIRECTORY_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

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
  resolveNameMock.mockReset().mockResolvedValue("Jane Smith");
});

// ═══════════════════════════════════════════════════════════════════

describe("create_directory_entry", () => {
  it("dispatches create_directory_entry with name + type", async () => {
    await createDirectoryEntryTool.handler(
      { name: "Jane Smith", type: "individual", email: "jane@example.com" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_directory_entry",
      expect.objectContaining({
        name: "Jane Smith",
        type: "individual",
        email: "jane@example.com",
      }),
    );
  });

  it("dryRun returns 'Create directory entry: {name} ({type})'", async () => {
    const result = await createDirectoryEntryTool.dryRun!(
      { name: "Jane Smith", type: "individual" },
      makeCtx(),
    );
    expect(result.summary).toBe("Create directory entry: Jane Smith (individual)");
  });
});

describe("update_directory_entry", () => {
  it("dispatches create_directory_entry (upsert reuse) with merged fields", async () => {
    await updateDirectoryEntryTool.handler(
      { directory_entry_id: DIRECTORY_ID, name: "Jane A. Smith" },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_directory_entry",
      expect.objectContaining({ name: "Jane A. Smith" }),
    );
  });
});

describe("archive_directory_entry", () => {
  it("dispatches archive_directory_entry", async () => {
    await archiveDirectoryEntryTool.handler(
      { directory_entry_id: DIRECTORY_ID },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "archive_directory_entry",
      expect.objectContaining({ directory_entry_id: DIRECTORY_ID }),
    );
  });

  it("dryRun returns 'Archive directory entry \"{name}\"'", async () => {
    resolveNameMock.mockResolvedValueOnce("Jane Smith");
    const result = await archiveDirectoryEntryTool.dryRun!(
      { directory_entry_id: DIRECTORY_ID },
      makeCtx(),
    );
    expect(result.summary).toBe('Archive directory entry "Jane Smith"');
  });
});
