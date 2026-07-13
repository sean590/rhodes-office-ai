import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module mocks (must come BEFORE the route import) -----------------------

vi.mock("@/lib/utils/org-context", () => ({
  requireOrg: async () => ({
    user: { id: "u-1" },
    orgId: "org-A",
  }),
  isError: (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    "status" in v &&
    typeof (v as { status: unknown }).status === "number",
}));

vi.mock("@/lib/chat/feature-flag", () => ({
  isMcpChatEnabled: () => true,
  isMcpWritesEnabled: () => false,
}));

// Record every admin insert so we can assert the error-assistant row was written.
interface RecordedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const adminInserts: RecordedInsert[] = [];
const adminUpdates: RecordedInsert[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const session = { id: "sess-1", organization_id: "org-A" };
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: table === "chat_sessions" ? session : null, error: null }),
            order: () => ({
              then: (r: (v: unknown) => unknown) =>
                r({ data: [{ role: "user", content: "why is my cat on fire" }], error: null }),
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          adminInserts.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
        update: (payload: Record<string, unknown>) => ({
          eq: () => {
            adminUpdates.push({ table, payload });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [{ role: "user", content: "why is my cat on fire" }],
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

// Throwing Anthropic client — messages.create rejects, simulating an upstream
// API outage. messages.stream is undefined (fallback to create → throws).
vi.mock("@anthropic-ai/sdk", () => {
  class AnthropicMock {
    messages = {
      create: () => Promise.reject(new Error("upstream is down")),
    };
  }
  return { default: AnthropicMock };
});

// Import AFTER all mocks are registered.
import { POST } from "../route";

beforeEach(() => {
  adminInserts.length = 0;
  adminUpdates.length = 0;
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat — orchestrator failure path (SSE)", () => {
  it("streams an error event and writes an assistant error row when orchestrator throws", async () => {
    const res = await POST(
      buildRequest({
        session_id: "11111111-1111-4111-8111-111111111111",
        message: "why is my cat on fire",
      }),
    );
    // SSE responses always return 200 — errors are emitted as events.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    // Read the full SSE stream.
    const text = await res.text();
    // The stream should contain an error event.
    expect(text).toContain("event: error");
    expect(text).toContain("Something went wrong");
    // The upstream error message should NOT appear in the SSE data.
    expect(text).not.toContain("upstream is down");

    // Two chat_messages inserts: (1) the user message, (2) the assistant
    // error row. Order matters so a page reload can render both.
    const chatInserts = adminInserts.filter((i) => i.table === "chat_messages");
    expect(chatInserts.length).toBe(2);
    expect(chatInserts[0].payload.role).toBe("user");
    expect(chatInserts[1].payload.role).toBe("assistant");
    expect(chatInserts[1].payload.content).toBe(
      "Something went wrong — please try again.",
    );
    const meta = chatInserts[1].payload.metadata as Record<string, unknown>;
    expect(meta.error).toBe("upstream is down");
    expect(meta.mcp_chat).toBe(true);

    // Session's updated_at touched even on the error path.
    expect(adminUpdates.some((u) => u.table === "chat_sessions")).toBe(true);
  });
});
