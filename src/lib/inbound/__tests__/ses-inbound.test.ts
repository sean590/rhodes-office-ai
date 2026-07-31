import { describe, it, expect } from "vitest";
import { parseRawEmail, sesThreatFlags, parseSesEvent } from "../ses-inbound";

// A minimal multipart MIME with a text part and a PDF attachment.
const PDF_B64 = Buffer.from("%PDF-1.4 fake pdf bytes").toString("base64");
const RAW = [
  "From: Ridge Capital <statements@ridgecap.com>",
  "To: smith-7f2a91@docs.rhodesoffice.ai",
  "Subject: Q2 statement attached",
  "Date: Wed, 30 Jul 2026 10:00:00 +0000",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain",
  "",
  "Your statement is attached. See https://ridgecap.com/portal for more.",
  "--b1",
  'Content-Type: application/pdf; name="q2-statement.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="q2-statement.pdf"',
  "",
  PDF_B64,
  "--b1--",
  "",
].join("\r\n");

describe("parseRawEmail (SES transport)", () => {
  it("parses sender, subject, body, and links into the InboundMessage shape", async () => {
    const msg = await parseRawEmail(RAW, "ses-abc123");
    expect(msg.id).toBe("ses-abc123");
    expect(msg.fromEmail).toBe("statements@ridgecap.com");
    expect(msg.subject).toBe("Q2 statement attached");
    expect(msg.bodyText).toContain("statement is attached");
    expect(msg.links).toContain("https://ridgecap.com/portal");
  });

  it("carries attachment bytes inline (no lazy fetch)", async () => {
    const msg = await parseRawEmail(RAW, "ses-abc123");
    expect(msg.attachments).toHaveLength(1);
    const att = msg.attachments[0];
    expect(att.filename).toBe("q2-statement.pdf");
    expect(att.mimeType).toBe("application/pdf");
    expect(att.bytes).toBeInstanceOf(Buffer);
    expect(att.bytes!.toString()).toContain("%PDF-1.4");
    expect(att.size).toBe(att.bytes!.length);
  });

  it("maps SES verdicts (PASS) → verified auth", async () => {
    const msg = await parseRawEmail(RAW, "id1", { spf: "PASS", dkim: "PASS", dmarc: "PASS" });
    expect(msg.auth).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass", verified: true });
  });

  it("maps SES DMARC FAIL → not verified (spoof held by the auth gate)", async () => {
    const msg = await parseRawEmail(RAW, "id2", { spf: "PASS", dkim: "FAIL", dmarc: "FAIL" });
    expect(msg.auth.dmarc).toBe("fail");
    expect(msg.auth.verified).toBe(false);
  });

  it("falls back to the Authentication-Results header when SES gives no verdicts", async () => {
    const withHeader = "Authentication-Results: mx; spf=pass; dkim=pass; dmarc=pass\r\n" + RAW;
    const msg = await parseRawEmail(withHeader, "id3");
    expect(msg.auth.verified).toBe(true);
  });

  it("surfaces SES spam/virus verdicts", () => {
    expect(sesThreatFlags({ virus: "FAIL" })).toEqual({ spam: false, virus: true });
    expect(sesThreatFlags({ spam: "FAIL" })).toEqual({ spam: true, virus: false });
    expect(sesThreatFlags({ spam: "PASS", virus: "PASS" })).toEqual({ spam: false, virus: false });
    expect(sesThreatFlags(undefined)).toEqual({ spam: false, virus: false });
  });
});

describe("parseSesEvent (SNS notification → webhook inputs)", () => {
  const notification = {
    mail: { messageId: "abc123", destination: ["smith-x@docs.rhodesoffice.ai"] },
    receipt: {
      recipients: ["smith-x@docs.rhodesoffice.ai"],
      spfVerdict: { status: "PASS" },
      dkimVerdict: { status: "PASS" },
      dmarcVerdict: { status: "PASS" },
      spamVerdict: { status: "PASS" },
      virusVerdict: { status: "FAIL" },
    },
  };

  it("extracts messageId, recipients, verdicts, and the S3 key", () => {
    const evt = parseSesEvent(notification)!;
    expect(evt.messageId).toBe("abc123");
    expect(evt.recipients).toEqual(["smith-x@docs.rhodesoffice.ai"]);
    expect(evt.s3Key).toBe("inbound/abc123");
    expect(evt.receipt).toMatchObject({ spf: "PASS", dkim: "PASS", dmarc: "PASS", virus: "FAIL" });
  });

  it("honors a custom object-key prefix", () => {
    expect(parseSesEvent(notification, "raw/")!.s3Key).toBe("raw/abc123");
  });

  it("returns null for a malformed / non-receipt payload", () => {
    expect(parseSesEvent({})).toBeNull();
    expect(parseSesEvent({ receipt: {} })).toBeNull();
  });

  it("falls back to mail.destination when receipt.recipients is absent", () => {
    const evt = parseSesEvent({ mail: { messageId: "z", destination: ["a@docs.rhodesoffice.ai"] } })!;
    expect(evt.recipients).toEqual(["a@docs.rhodesoffice.ai"]);
  });
});
