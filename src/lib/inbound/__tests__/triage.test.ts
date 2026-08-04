import { describe, it, expect } from "vitest";
import { triageMessage } from "../triage";
import type { InboundMessage } from "../gmail";

function msg(overrides: Partial<InboundMessage>): InboundMessage {
  return {
    id: "m1",
    threadId: "t1",
    internalDate: 1_700_000_000_000,
    from: "Sender <sender@example.com>",
    fromEmail: "sender@example.com",
    subject: "",
    snippet: "",
    bodyText: "",
    links: [],
    attachments: [],
    auth: { spf: "pass", dkim: "pass", dmarc: "pass", verified: true },
    ...overrides,
  };
}

const att = (filename: string, mimeType: string, size = 1000) => ({
  attachmentId: "a1",
  filename,
  mimeType,
  size,
});

describe("triageMessage", () => {
  it("PDF attachment → attachment", () => {
    const r = triageMessage(msg({ attachments: [att("k1-2025.pdf", "application/pdf")] }), { knownProviderSender: false });
    expect(r.classification).toBe("attachment");
    expect(r.ingestableAttachments).toHaveLength(1);
  });

  it("noise attachments (ics/vcf, zero-byte, txt) are not ingestable", () => {
    const r = triageMessage(
      msg({
        attachments: [
          att("invite.ics", "text/calendar"),
          att("card.vcf", "text/vcard"),
          att("empty.pdf", "application/pdf", 0),
          att("notes.txt", "text/plain"),
        ],
      }),
      { knownProviderSender: false },
    );
    expect(r.classification).not.toBe("attachment");
  });

  it("signature/inline images are not ingestable (found live: 5 signature PNGs)", () => {
    const r = triageMessage(
      msg({
        attachments: [
          att("image001.png", "image/png", 8_000),
          att("image002.png", "image/png", 12_000),
          att("logo.gif", "image/gif", 4_000), // small image, non-imageNNN name
        ],
      }),
      { knownProviderSender: true },
    );
    expect(r.classification).not.toBe("attachment");
  });

  it("a real scanned-document image (large) still ingests alongside signature junk", () => {
    const r = triageMessage(
      msg({
        attachments: [
          att("image001.png", "image/png", 8_000),
          att("scan-k1-page1.jpg", "image/jpeg", 900_000),
        ],
      }),
      { knownProviderSender: true },
    );
    expect(r.classification).toBe("attachment");
    expect(r.ingestableAttachments).toHaveLength(1);
    expect(r.ingestableAttachments[0].filename).toBe("scan-k1-page1.jpg");
  });

  it("SafeSend SendLinkRedirect → safesend, and the link is captured", () => {
    const link = "https://www.safesendreturns.com/SendLinkRedirect/abc123";
    const r = triageMessage(
      msg({ fromEmail: "noreply@safesendreturns.com", links: [link], bodyText: "Your documents are ready" }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("safesend");
    expect(r.safesendLink).toBe(link);
  });

  it("SafeSend DropOff (upload form) is NEVER treated as a download", () => {
    const r = triageMessage(
      msg({ fromEmail: "noreply@safesendreturns.com", links: ["https://www.safesendreturns.com/DropOff/xyz"] }),
      { knownProviderSender: false },
    );
    expect(r.classification).not.toBe("safesend");
  });

  it("portal notification sender (ShareFile) → needs_user", () => {
    const r = triageMessage(
      msg({ fromEmail: "noreply@sf-notifications.com", subject: "Files shared with you", links: ["https://x.sharefile.com/d/abc"] }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("needs_user");
  });

  it("known provider announcing a document → needs_user", () => {
    const r = triageMessage(
      msg({
        fromEmail: "admin@boutiquefirm.com",
        subject: "Your tax return is available",
        bodyText: "Please log in to view your tax return",
        links: ["https://portal.boutiquefirm.com/login"],
      }),
      { knownProviderSender: true },
    );
    expect(r.classification).toBe("needs_user");
  });

  it("unknown sender with delivery phrasing + link → needs_user (over-nudge beats silent miss)", () => {
    const r = triageMessage(
      msg({
        fromEmail: "noreply@unknownvault.io",
        subject: "A secure document has been shared with you",
        links: ["https://unknownvault.io/dl/1"],
      }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("needs_user");
  });

  // Regression (found live): a CPA-thread REPLY — bare "tax return" / "K-1"
  // mentions in the quoted history, only link is the CPA signature's SafeSend
  // DropOff (upload). Not a delivery; must NOT nudge.
  it("CPA conversational reply (bare doc-nouns + signature upload link) → ignored", () => {
    const r = triageMessage(
      msg({
        fromEmail: "leslie@channels.com",
        subject: "Re: LADD Holdings LLC",
        bodyText:
          "Hi Hailey, the $19,331 was a distribution from Silverhawk. There is a Schwab account for LADD. " +
          "We are waiting for the final tax return to be filed and copies of the final K-1s from Harris. " +
          "In order to keep your information secure, please transfer files to BPW using our Secure Upload.",
        links: ["https://exchange-taxpayer.safesendreturns.com/DropOff/jm70000w00000", "https://bpw.com"],
      }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("ignored");
  });

  // A KNOWN provider (the CPA) mentioning doc types conversationally is still
  // not a delivery without delivery intent.
  it("known provider mentioning K-1/tax return as nouns (no intent) → ignored", () => {
    const r = triageMessage(
      msg({
        fromEmail: "hsimms@bpw.com",
        subject: "RE: LADD Holdings LLC",
        bodyText: "Once we get your input we can provide preliminary financials. We still need the final K-1s and the tax return.",
        links: ["https://bpw.com", "https://www.linkedin.com/company/bpw"],
      }),
      { knownProviderSender: true },
    );
    expect(r.classification).toBe("ignored");
  });

  it("newsletter → ignored", () => {
    const r = triageMessage(
      msg({
        fromEmail: "news@substack.com",
        subject: "This week in markets",
        bodyText: "Top stories this week. Unsubscribe anytime.",
        links: ["https://substack.com/post/1"],
      }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("ignored");
  });

  it("attachments win over links (statement PDF attached + tracking links)", () => {
    const r = triageMessage(
      msg({
        attachments: [att("statement.pdf", "application/pdf")],
        links: ["https://tracker.example.com/open"],
        subject: "Your statement is attached",
      }),
      { knownProviderSender: true },
    );
    expect(r.classification).toBe("attachment");
  });

  // ── Hardening: host allowlist + sender-auth gate ─────────────────────

  it("SendLinkRedirect on a NON-SafeSend host is never visited — held as needs_user", () => {
    const r = triageMessage(
      msg({ fromEmail: "noreply@evil.example", links: ["https://evil.example/SendLinkRedirect/abc123"] }),
      { knownProviderSender: false },
    );
    expect(r.classification).toBe("needs_user");
    expect(r.reason).toBe("secure link on an unrecognized host");
    expect(r.safesendLink).toBeNull();
    expect(r.safesendLinks).toHaveLength(0);
  });

  it("lookalike host (safesendreturns.com.evil.example) fails the allowlist", () => {
    const r = triageMessage(
      msg({ fromEmail: "noreply@safesendreturns.com", links: ["https://safesendreturns.com.evil.example/SendLinkRedirect/x"] }),
      { knownProviderSender: false },
    );
    expect(r.classification).not.toBe("safesend");
  });

  it("active-spoof (dmarc=fail) attachment is HELD, not filed (forged-document gate)", () => {
    const r = triageMessage(
      msg({
        attachments: [att("capital-call.pdf", "application/pdf")],
        auth: { spf: "fail", dkim: "fail", dmarc: "fail", verified: false },
      }),
      { knownProviderSender: true, senderVerified: false },
    );
    expect(r.classification).toBe("needs_user");
    expect(r.reason).toBe("sender failed DMARC — possible spoof, held for review");
    expect(r.ingestableAttachments).toHaveLength(0);
  });

  it("a 'gray' forward (dmarc not fail) auto-ingests — the worker passes senderVerified=true for it", () => {
    // Forwards structurally can't pass SPF/DKIM alignment (gray), but they're
    // the primary flow. worker.ts computes senderVerified = dmarc !== "fail",
    // so a gray forward arrives here trusted and its attachment is filed.
    const r = triageMessage(
      msg({
        attachments: [att("invoice.pdf", "application/pdf")],
        auth: { spf: "gray", dkim: "gray", dmarc: "gray", verified: false },
      }),
      { knownProviderSender: false, senderVerified: true },
    );
    expect(r.classification).toBe("attachment");
    expect(r.ingestableAttachments).toHaveLength(1);
  });

  it("unverified sender with a real SafeSend link is held too (real SafeSend passes DMARC)", () => {
    const r = triageMessage(
      msg({ fromEmail: "noreply@safesendreturns.com", links: ["https://www.safesendreturns.com/SendLinkRedirect/abc"] }),
      { knownProviderSender: false, senderVerified: false },
    );
    expect(r.classification).toBe("needs_user");
    expect(r.reason).toBe("sender failed authentication");
    expect(r.safesendLink).toBeNull();
  });

  it("unverified newsletter still just gets ignored (the gate only guards ingestion)", () => {
    const r = triageMessage(
      msg({ fromEmail: "news@substack.com", bodyText: "Top stories. Unsubscribe anytime." }),
      { knownProviderSender: false, senderVerified: false },
    );
    expect(r.classification).toBe("ignored");
  });
});
