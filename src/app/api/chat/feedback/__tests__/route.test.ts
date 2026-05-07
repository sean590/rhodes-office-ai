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

interface CapturedUpsert {
  payload: Record<string, unknown>;
  options: Record<string, unknown>;
}
interface CapturedDelete {
  filters: Record<string, unknown>;
}
const upserts: CapturedUpsert[] = [];
const deletes: CapturedDelete[] = [];
// Mutable script for the message lookup query per test.
const messageScript: {
  next: {
    data:
      | null
      | {
          id: string;
          role: string;
          session_id: string;
          chat_sessions: { organization_id: string };
        };
    error: unknown;
  };
} = { next: { data: null, error: null } };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "chat_messages") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(messageScript.next),
            }),
          }),
        };
      }
      // chat_feedback
      return {
        upsert: (payload: Record<string, unknown>, options: Record<string, unknown>) => {
          upserts.push({ payload, options });
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "fb-1", ...payload },
                  error: null,
                }),
            }),
          };
        },
        delete: () => {
          const filters: Record<string, unknown> = {};
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, val: unknown) => {
            filters[col] = val;
            // Second .eq resolves the whole chain (user_id + message_id).
            if (Object.keys(filters).length >= 2) {
              deletes.push({ filters });
              return Promise.resolve({ data: null, error: null });
            }
            return chain;
          };
          return chain;
        },
      };
    },
  }),
}));

import { POST, DELETE } from "../route";

beforeEach(() => {
  upserts.length = 0;
  deletes.length = 0;
});

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/chat/feedback", () => {
  it("valid thumbs-up submit returns ok + persists via upsert", async () => {
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-1",
        chat_sessions: { organization_id: "org-A" },
      },
      error: null,
    };
    const res = await POST(buildRequest({ message_id: VALID_UUID, rating: "up" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload.rating).toBe("up");
    expect(upserts[0].payload.user_id).toBe("u-1");
    expect(upserts[0].payload.organization_id).toBe("org-A");
    expect(upserts[0].options.onConflict).toBe("user_id,message_id");
  });

  it("404s when the message belongs to another org (no existence leak)", async () => {
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-other",
        chat_sessions: { organization_id: "org-B" },
      },
      error: null,
    };
    const res = await POST(
      buildRequest({ message_id: VALID_UUID, rating: "down", comment: "wrong answer" }),
    );
    expect(res.status).toBe(404);
    expect(upserts).toHaveLength(0);
  });

  it("404s when the message doesn't exist at all", async () => {
    messageScript.next = { data: null, error: null };
    const res = await POST(buildRequest({ message_id: VALID_UUID, rating: "up" }));
    expect(res.status).toBe(404);
    expect(upserts).toHaveLength(0);
  });

  it("400s on a non-assistant message", async () => {
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "user",
        session_id: "s-1",
        chat_sessions: { organization_id: "org-A" },
      },
      error: null,
    };
    const res = await POST(buildRequest({ message_id: VALID_UUID, rating: "down" }));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("upsert replaces a prior rating (same user_id + message_id hits onConflict)", async () => {
    // First: thumbs up.
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-1",
        chat_sessions: { organization_id: "org-A" },
      },
      error: null,
    };
    await POST(buildRequest({ message_id: VALID_UUID, rating: "up" }));
    // Then: thumbs down with a comment. onConflict target matches.
    await POST(
      buildRequest({ message_id: VALID_UUID, rating: "down", comment: "on second thought" }),
    );
    expect(upserts).toHaveLength(2);
    expect(upserts[0].payload.rating).toBe("up");
    expect(upserts[1].payload.rating).toBe("down");
    expect(upserts[1].payload.comment).toBe("on second thought");
    // Same conflict target on both — ensures the DB treats these as the same logical row.
    expect(upserts[0].options.onConflict).toBe(upserts[1].options.onConflict);
  });

  it("400s when comment exceeds the 2000 char cap", async () => {
    const res = await POST(
      buildRequest({
        message_id: VALID_UUID,
        rating: "down",
        comment: "x".repeat(2001),
      }),
    );
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("400s when rating is neither 'up' nor 'down'", async () => {
    const res = await POST(
      buildRequest({ message_id: VALID_UUID, rating: "maybe" }),
    );
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("400s when message_id is not a UUID", async () => {
    const res = await POST(buildRequest({ message_id: "not-a-uuid", rating: "up" }));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
});

function buildDeleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/feedback", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/chat/feedback", () => {
  it("valid delete returns 200 and hits delete with user_id + message_id filters", async () => {
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-1",
        chat_sessions: { organization_id: "org-A" },
      },
      error: null,
    };
    const res = await DELETE(buildDeleteRequest({ message_id: VALID_UUID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters.user_id).toBe("u-1");
    expect(deletes[0].filters.message_id).toBe(VALID_UUID);
  });

  it("is idempotent: deleting a row that doesn't exist still returns 200", async () => {
    // Same contract — mock delete succeeds regardless of row count.
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-1",
        chat_sessions: { organization_id: "org-A" },
      },
      error: null,
    };
    const res = await DELETE(buildDeleteRequest({ message_id: VALID_UUID }));
    expect(res.status).toBe(200);
    // Exactly one delete query was issued even if there was nothing to remove.
    expect(deletes).toHaveLength(1);
  });

  it("404s when the message is in another org (no existence leak)", async () => {
    messageScript.next = {
      data: {
        id: VALID_UUID,
        role: "assistant",
        session_id: "s-other",
        chat_sessions: { organization_id: "org-B" },
      },
      error: null,
    };
    const res = await DELETE(buildDeleteRequest({ message_id: VALID_UUID }));
    expect(res.status).toBe(404);
    expect(deletes).toHaveLength(0);
  });

  it("404s when message_id doesn't resolve to any message", async () => {
    messageScript.next = { data: null, error: null };
    const res = await DELETE(buildDeleteRequest({ message_id: VALID_UUID }));
    expect(res.status).toBe(404);
    expect(deletes).toHaveLength(0);
  });

  it("400s when message_id is not a UUID", async () => {
    const res = await DELETE(buildDeleteRequest({ message_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(deletes).toHaveLength(0);
  });
});
