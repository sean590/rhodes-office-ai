/**
 * Functional smoke tests for service-provider write tools.
 *
 * Verifies dispatch routing for create/update/delete + link/unlink, dryRun
 * summaries, and — critically — cross-org isolation: when ownership
 * verification rejects (resource belongs to another org), the handler must
 * throw and never reach dispatchAction.
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
  createServiceProviderTool,
  updateServiceProviderTool,
  deleteServiceProviderTool,
  linkProviderEntityTool,
  unlinkProviderEntityTool,
} from "../tools/service-providers-write";

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "33333333-3333-4333-8333-333333333333";
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
  resolveNameMock.mockReset().mockResolvedValue("Andersen");
});

// ═══════════════════════════════════════════════════════════════════

describe("create_service_provider", () => {
  it("dispatches create_service_provider with the input", async () => {
    await createServiceProviderTool.handler(
      { name: "Andersen", disciplines: ["tax"], domains: ["andersen.com"] },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "create_service_provider",
      expect.objectContaining({ name: "Andersen", disciplines: ["tax"] }),
    );
  });

  it("dryRun returns 'Create service provider: {name}'", async () => {
    const result = await createServiceProviderTool.dryRun!({ name: "Andersen" }, makeCtx());
    expect(result.summary).toBe("Create service provider: Andersen");
  });
});

describe("update_service_provider", () => {
  it("verifies ownership then dispatches update_service_provider", async () => {
    await updateServiceProviderTool.handler(
      { provider_id: PROVIDER_ID, name: "Andersen Tax" },
      makeCtx(),
    );
    expect(ownershipMock).toHaveBeenCalledWith(
      expect.anything(),
      { resourceType: "service_provider", resourceId: PROVIDER_ID },
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "update_service_provider",
      expect.objectContaining({ provider_id: PROVIDER_ID, name: "Andersen Tax" }),
    );
  });
});

describe("delete_service_provider", () => {
  it("dispatches delete_service_provider", async () => {
    await deleteServiceProviderTool.handler({ provider_id: PROVIDER_ID }, makeCtx());
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "delete_service_provider",
      expect.objectContaining({ provider_id: PROVIDER_ID }),
    );
  });
});

describe("link_provider_entity", () => {
  it("verifies provider + entity ownership then dispatches", async () => {
    await linkProviderEntityTool.handler(
      { provider_id: PROVIDER_ID, entity_id: ENTITY_ID },
      makeCtx(),
    );
    expect(ownershipMock).toHaveBeenCalledWith(
      expect.anything(),
      { resourceType: "service_provider", resourceId: PROVIDER_ID },
    );
    expect(ownershipMock).toHaveBeenCalledWith(
      expect.anything(),
      { resourceType: "entity", resourceId: ENTITY_ID },
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "link_provider_entity",
      expect.objectContaining({ provider_id: PROVIDER_ID, entity_id: ENTITY_ID }),
    );
  });
});

describe("unlink_provider_entity", () => {
  it("dispatches unlink_provider_entity", async () => {
    await unlinkProviderEntityTool.handler(
      { provider_id: PROVIDER_ID, entity_id: ENTITY_ID },
      makeCtx(),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      "unlink_provider_entity",
      expect.objectContaining({ provider_id: PROVIDER_ID, entity_id: ENTITY_ID }),
    );
  });
});

// ── Cross-org isolation ────────────────────────────────────────────

describe("cross-org isolation", () => {
  it("update rejects and never dispatches when the provider is in another org", async () => {
    ownershipMock.mockRejectedValueOnce(new Error("not_found"));
    await expect(
      updateServiceProviderTool.handler({ provider_id: PROVIDER_ID, name: "x" }, makeCtx()),
    ).rejects.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("delete rejects and never dispatches when the provider is in another org", async () => {
    ownershipMock.mockRejectedValueOnce(new Error("not_found"));
    await expect(
      deleteServiceProviderTool.handler({ provider_id: PROVIDER_ID }, makeCtx()),
    ).rejects.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("link rejects and never dispatches when the entity is in another org", async () => {
    // Provider ownership passes; entity ownership (2nd call) fails.
    ownershipMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("not_found"));
    await expect(
      linkProviderEntityTool.handler({ provider_id: PROVIDER_ID, entity_id: ENTITY_ID }, makeCtx()),
    ).rejects.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
