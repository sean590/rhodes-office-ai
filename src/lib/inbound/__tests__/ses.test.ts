import { describe, it, expect } from "vitest";
import { buildInboundMessageFromMime, resolveOrgByRecipients } from "../ses";

// A minimal raw MIME email with a text body (+ link) and one PDF attachment.
function sampleMime(): Buffer {
  const pdfBytes = Buffer.from("%PDF-1.4 fake pdf body").toString("base64");
  return Buffer.from(
    [
      "From: Alice Advisor <alice@advisorfirm.com>",
      "To: rhodes-abc123@docs.rhodesoffice.ai",
      "Subject: Q2 K-1 attached",
      'Content-Type: multipart/mixed; boundary="b0"',
      "",
      "--b0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please find the K-1. Portal: https://portal.advisorfirm.com/doc/9.",
      "--b0",
      'Content-Type: application/pdf; name="k1.pdf"',
      'Content-Disposition: attachment; filename="k1.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      pdfBytes,
      "--b0--",
      "",
    ].join("\r\n"),
  );
}

const sesMail = {
  messageId: "ses-msg-1",
  source: "alice@advisorfirm.com",
  destination: ["rhodes-abc123@docs.rhodesoffice.ai"],
  timestamp: "2026-08-02T18:00:00.000Z",
  commonHeaders: { from: ["Alice Advisor <alice@advisorfirm.com>"], to: ["rhodes-abc123@docs.rhodesoffice.ai"], subject: "Q2 K-1 attached" },
};

describe("SES inbound — MIME → InboundMessage", () => {
  it("parses sender, subject, links, and attachment bytes", async () => {
    const msg = await buildInboundMessageFromMime(
      sesMail,
      { spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" }, dmarcVerdict: { status: "PASS" } },
      sampleMime(),
    );
    expect(msg.id).toBe("ses-msg-1");
    expect(msg.fromEmail).toBe("alice@advisorfirm.com");
    expect(msg.subject).toBe("Q2 K-1 attached");
    expect(msg.links).toContain("https://portal.advisorfirm.com/doc/9");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("k1.pdf");
    expect(msg.attachments[0].mimeType).toBe("application/pdf");
    expect(msg.attachments[0].content?.length).toBeGreaterThan(0);
    // SES verdicts flow through the same gate as Gmail → verified.
    expect(msg.auth.verified).toBe(true);
  });

  it("does NOT mark verified when DMARC fails (spoof signal)", async () => {
    const msg = await buildInboundMessageFromMime(
      sesMail,
      { spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" }, dmarcVerdict: { status: "FAIL" } },
      sampleMime(),
    );
    expect(msg.auth.verified).toBe(false);
  });
});

describe("SES inbound — org routing", () => {
  function fakeAdmin(rows: Array<{ organization_id: string; local_part: string }>) {
    let capturedLocals: string[] = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: (_col: string, locals: string[]) => {
        capturedLocals = locals;
        return chain;
      },
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    return { admin: { from: () => chain }, getLocals: () => capturedLocals };
  }

  it("resolves the org from a hosted recipient address", async () => {
    const { admin, getLocals } = fakeAdmin([{ organization_id: "org-9", local_part: "rhodes-abc123" }]);
    const org = await resolveOrgByRecipients(admin as never, [
      "someone-else@gmail.com",
      "rhodes-abc123@docs.rhodesoffice.ai",
    ]);
    expect(org).toBe("org-9");
    expect(getLocals()).toEqual(["rhodes-abc123"]); // only the hosted-domain recipient
  });

  it("returns null when no recipient is on the hosted domain", async () => {
    const { admin } = fakeAdmin([]);
    const org = await resolveOrgByRecipients(admin as never, ["random@gmail.com"]);
    expect(org).toBeNull();
  });
});
