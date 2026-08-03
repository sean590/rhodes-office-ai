import { describe, it, expect } from "vitest";
import { extractAccessCode, fairSafesendPick } from "../worker";
import type { InboundMessage } from "../gmail";

function msg(p: Partial<InboundMessage>): InboundMessage {
  return {
    id: "m", threadId: "t", internalDate: Date.now(),
    from: "noreply@safesendreturns.com", fromEmail: "noreply@safesendreturns.com",
    subject: "", snippet: "", bodyText: "", links: [], attachments: [],
    auth: { spf: "pass", dkim: "pass", dmarc: "pass", verified: true },
    ...p,
  };
}

describe("SafeSend access-code recognition", () => {
  it("extracts the 8-digit code from an access-code email", () => {
    const m = msg({
      subject: "Your Access Code from Bartlett Pringle & Wolf",
      bodyText: "Your SafeSend access code is 48213907. Enter it to view the documents.",
    });
    expect(extractAccessCode(m)).toBe("48213907");
  });

  it("returns null for a document-delivery email (has a SafeSend link, but no 'access code')", () => {
    const m = msg({
      subject: "RE: LADD Holdings Trust to LADD Holdings LLC Transition",
      bodyText: "Documents are ready: https://exchange-taxpayer.safesendreturns.com/SendLinkRedirect/v0123",
      links: ["https://exchange-taxpayer.safesendreturns.com/SendLinkRedirect/v0123"],
    });
    expect(extractAccessCode(m)).toBeNull();
  });

  it("returns null when 'access code' is present but there's no 8-digit code", () => {
    const m = msg({ subject: "About your access code", bodyText: "Your access code will arrive shortly." });
    expect(extractAccessCode(m)).toBeNull();
  });

  it("ignores non-8-digit numbers", () => {
    const m = msg({ subject: "Your access code", bodyText: "Reference 12345 (5 digits) and 123456789 (9)." });
    expect(extractAccessCode(m)).toBeNull();
  });
});

describe("SafeSend sweep fairness (fairSafesendPick)", () => {
  const d = (id: string, org: string) => ({ id, organization_id: org });

  it("round-robins across orgs — no single org monopolizes the cap", () => {
    // orgA has 3 (older), orgB has 1. Cap 3 → A, B, A (B served before A's 2nd).
    const cands = [d("a1", "A"), d("a2", "A"), d("a3", "A"), d("b1", "B")];
    const picked = fairSafesendPick(cands, 3).map((p) => p.id);
    expect(picked).toHaveLength(3);
    expect(picked).toContain("a1"); // A's oldest
    expect(picked).toContain("b1"); // B gets a slot despite A's backlog
    expect(picked).not.toContain("a3"); // A's third waits
  });

  it("a lone org fills every free slot (drains fast when uncontended)", () => {
    const cands = [d("a1", "A"), d("a2", "A"), d("a3", "A"), d("a4", "A")];
    const picked = fairSafesendPick(cands, 3).map((p) => p.id);
    expect(picked).toEqual(["a1", "a2", "a3"]);
  });

  it("never exceeds the cap and handles fewer candidates than the cap", () => {
    expect(fairSafesendPick([d("a1", "A"), d("b1", "B")], 3)).toHaveLength(2);
    expect(fairSafesendPick([], 3)).toHaveLength(0);
  });
});
