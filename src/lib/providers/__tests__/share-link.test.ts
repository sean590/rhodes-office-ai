/**
 * Server-side validation for the public share surface. Every failure mode —
 * unknown token, revoked, expired, failed send — must collapse to null (the
 * caller shows one generic "no longer available" message).
 */

import { describe, it, expect } from "vitest";
import { lookupValidSend } from "../share-link";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function makeSupabase(row: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

const validRow = {
  id: "s1",
  organization_id: "o1",
  document_id: "d1",
  provider_id: "p1",
  subject: null,
  message: null,
  sent_by: null,
  status: "sent",
  share_token: "tok",
  expires_at: FUTURE,
  revoked_at: null,
};

describe("lookupValidSend", () => {
  it("returns the send for a valid, unexpired, unrevoked token", async () => {
    const send = await lookupValidSend(makeSupabase(validRow), "tok");
    expect(send?.id).toBe("s1");
  });

  it("returns null for an unknown token", async () => {
    expect(await lookupValidSend(makeSupabase(null), "nope")).toBeNull();
  });

  it("returns null for a missing token", async () => {
    expect(await lookupValidSend(makeSupabase(validRow), undefined)).toBeNull();
  });

  it("returns null when revoked", async () => {
    expect(await lookupValidSend(makeSupabase({ ...validRow, revoked_at: PAST }), "tok")).toBeNull();
  });

  it("returns null when expired", async () => {
    expect(await lookupValidSend(makeSupabase({ ...validRow, expires_at: PAST }), "tok")).toBeNull();
  });

  it("returns null when the send itself failed", async () => {
    expect(await lookupValidSend(makeSupabase({ ...validRow, status: "failed" }), "tok")).toBeNull();
  });
});
