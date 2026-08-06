import { describe, it, expect } from "vitest";
import { marketingFooter, withMarketingFooter, renderMarketingEmail, MARKETING_POSTAL_ADDRESS } from "../email-marketing";

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

describe("renderMarketingEmail (branded shell)", () => {
  const html = renderMarketingEmail({
    heading: "Your family office, organized",
    bodyHtml: "<p>Body copy here.</p>",
    cta: { label: "Start your trial", url: "https://rhodesoffice.ai" },
    previewText: "The system of record for your family office.",
  });

  it("includes the brand logo lockup, heading, body, CTA, and compliant footer", () => {
    expect(html).toContain(">Rhodes</td>"); // wordmark
    expect(html).toContain(">R</td>"); // logo mark
    expect(html).toContain("Your family office, organized");
    expect(html).toContain("Body copy here.");
    expect(html).toContain("Start your trial");
    expect(html).toContain("https://rhodesoffice.ai");
    expect(html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(html).toContain(MARKETING_POSTAL_ADDRESS);
  });

  it("omits the CTA block when no cta is given", () => {
    const noCta = renderMarketingEmail({ heading: "Hi", bodyHtml: "<p>x</p>" });
    expect(noCta).not.toContain("border-radius:10px\"><a"); // no button
    expect(noCta).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}"); // footer still present
  });
});
