import { describe, it, expect } from "vitest";
import { resolveEntitlements } from "../entitlements";
import { TRIAL_DOC_LIMIT, MONTHLY_DOC_METER } from "../plans";

const NOW = new Date("2026-08-04T00:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const row = (o: Partial<Parameters<typeof resolveEntitlements>[0]>) => ({
  billing_plan: null,
  billing_status: null,
  trial_ends_at: null,
  cancel_at_period_end: null,
  ...o,
});

describe("resolveEntitlements", () => {
  it("active paid → usable, monthly meter", () => {
    const e = resolveEntitlements(row({ billing_status: "active" }), NOW);
    expect(e.state).toBe("active");
    expect(e.isActive).toBe(true);
    expect(e.canUpload).toBe(true);
    expect(e.docLimit).toBe(MONTHLY_DOC_METER);
  });

  it("past_due → still usable during dunning", () => {
    const e = resolveEntitlements(row({ billing_status: "past_due" }), NOW);
    expect(e.state).toBe("past_due");
    expect(e.isActive).toBe(true);
    expect(e.canUpload).toBe(true);
  });

  it("canceled → locked out", () => {
    const e = resolveEntitlements(row({ billing_status: "canceled" }), NOW);
    expect(e.state).toBe("canceled");
    expect(e.isActive).toBe(false);
    expect(e.canUpload).toBe(false);
  });

  it("live trial → trial limit + days-left (ceil)", () => {
    const e = resolveEntitlements(row({ billing_plan: "trial", trial_ends_at: inDays(9.2) }), NOW);
    expect(e.state).toBe("trial");
    expect(e.isActive).toBe(true);
    expect(e.docLimit).toBe(TRIAL_DOC_LIMIT);
    expect(e.trialDaysLeft).toBe(10);
  });

  it("expired trial → locked out, 0 days", () => {
    const e = resolveEntitlements(row({ billing_plan: "trial", trial_ends_at: inDays(-1) }), NOW);
    expect(e.state).toBe("trial_expired");
    expect(e.isActive).toBe(false);
    expect(e.canUpload).toBe(false);
    expect(e.trialDaysLeft).toBe(0);
  });

  it("no billing set → 'none', not active", () => {
    const e = resolveEntitlements(row({}), NOW);
    expect(e.state).toBe("none");
    expect(e.isActive).toBe(false);
  });
});
