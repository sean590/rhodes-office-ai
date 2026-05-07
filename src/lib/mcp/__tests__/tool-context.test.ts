import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock requireOrg BEFORE importing tool-context so the session-driven orgId
// path is deterministic. The spec guarantee we're verifying: orgId comes from
// the session, never from caller-supplied arguments.

const mockRequireOrg = vi.fn();

vi.mock("@/lib/utils/org-context", () => ({
  requireOrg: () => mockRequireOrg(),
  isError: (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    "status" in v &&
    typeof (v as { status: unknown }).status === "number",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __mock: true }),
}));

import { buildToolContext } from "../tool-context";
import { listEntitiesTool } from "../tools/entities";

beforeEach(() => {
  mockRequireOrg.mockReset();
});

describe("buildToolContext", () => {
  it("pulls userId and orgId from the session", async () => {
    mockRequireOrg.mockResolvedValue({
      user: { id: "user-from-session" },
      orgId: "org-from-session",
    });

    const result = await buildToolContext("session-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe("user-from-session");
      expect(result.ctx.orgId).toBe("org-from-session");
      expect(result.ctx.sessionId).toBe("session-1");
    }
  });

  it("returns the auth-failure response when requireOrg errors", async () => {
    const errResp = new Response("nope", { status: 401 });
    mockRequireOrg.mockResolvedValue(errResp);

    const result = await buildToolContext("session-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response).toBe(errResp);
    }
  });
});

describe("tool input schemas cannot override organization_id", () => {
  // Structural guarantee: Zod objects default to stripping unknown keys. Any
  // organization_id smuggled in via args is dropped before the handler sees
  // it, so ctx.orgId is the only source of truth.
  it("list_entities schema strips organization_id from args", () => {
    const parsed = listEntitiesTool.inputSchema.parse({
      organization_id: "ATTACKER-ORG",
      name_query: "Acme",
    });
    expect("organization_id" in parsed).toBe(false);
    expect(parsed.name_query).toBe("Acme");
  });
});
