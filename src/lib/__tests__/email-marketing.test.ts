import { describe, it, expect } from "vitest";
import { marketingFooter, withMarketingFooter, MARKETING_POSTAL_ADDRESS } from "../email-marketing";

describe("marketing email footer (CAN-SPAM)", () => {
  it("footer carries the physical postal address AND a working unsubscribe", () => {
    const f = marketingFooter();
    expect(f).toContain(MARKETING_POSTAL_ADDRESS);
    expect(MARKETING_POSTAL_ADDRESS).toMatch(/West Hollywood/);
    // Resend expands this per-recipient and drives List-Unsubscribe headers.
    expect(f).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
  });

  it("withMarketingFooter appends the footer when absent", () => {
    const out = withMarketingFooter("<p>Hello</p>");
    expect(out).toContain("<p>Hello</p>");
    expect(out).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(out).toContain(MARKETING_POSTAL_ADDRESS);
  });

  it("withMarketingFooter is idempotent (no double footer if caller already included the unsubscribe tag)", () => {
    const already = "<p>Hi</p>{{{RESEND_UNSUBSCRIBE_URL}}}";
    expect(withMarketingFooter(already)).toBe(already);
  });
});
