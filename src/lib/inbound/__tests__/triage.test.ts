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
});
