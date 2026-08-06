import { describe, it, expect } from "vitest";
import { priceLookupKey, FOUNDING } from "../plans";
import { CONSENT_DOC_VERSION } from "../consent";

describe("billing plans", () => {
  it("exposes stable Stripe lookup keys per interval (mode-correct cutover, A2)", () => {
    expect(priceLookupKey("month")).toBe("founding_monthly");
    expect(priceLookupKey("year")).toBe("founding_annual");
  });

  it("each price ref carries its lookup key", () => {
    expect(FOUNDING.prices.month.lookupKey).toBe("founding_monthly");
    expect(FOUNDING.prices.year.lookupKey).toBe("founding_annual");
  });
});

describe("consent doc version (A4)", () => {
  it("defaults to a real dated version, not the draft placeholder", () => {
    // env override wins; the code default must be the published value.
    if (!process.env.CONSENT_DOC_VERSION) {
      expect(CONSENT_DOC_VERSION).toBe("2026-08-04.v1");
    }
    expect(CONSENT_DOC_VERSION).not.toContain("draft");
  });
});
