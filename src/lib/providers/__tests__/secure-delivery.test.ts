/**
 * SecureDelivery factory: fail-safe for unconfigured/vendor-not-ready impls,
 * and the rhodes_link path (token generation + expiry, no plaintext attachment).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const baseInput = {
  documents: [{ filename: "k1.pdf", mimeType: "application/pdf", getBuffer: async () => Buffer.from("PDFBYTES") }],
  recipientEmail: "cpa@andersen.com",
  senderName: "sean",
  providerName: "Andersen",
};

async function freshFactory() {
  vi.resetModules();
  return (await import("../secure-delivery")).getSecureDelivery;
}

beforeEach(() => {
  sendEmailMock.mockReset().mockResolvedValue({ id: "email-1" });
  delete process.env.SECURE_DELIVERY_PROVIDER;
  delete process.env.SENDSAFELY_API_KEY;
  delete process.env.SENDSAFELY_API_SECRET;
  delete process.env.SENDSAFELY_HOST;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
});

describe("getSecureDelivery — fail-safe", () => {
  it("returns a failing 'unconfigured' impl when no provider is set", async () => {
    const getSecureDelivery = await freshFactory();
    const result = await getSecureDelivery().send(baseInput);
    expect(result.status).toBe("failed");
    expect(result.provider).toBe("unconfigured");
  });

  it("fails closed when sendsafely is selected but has no credentials", async () => {
    process.env.SECURE_DELIVERY_PROVIDER = "sendsafely";
    const getSecureDelivery = await freshFactory();
    const result = await getSecureDelivery().send(baseInput);
    expect(result.status).toBe("failed");
    expect(result.provider).toBe("sendsafely");
  });
});

describe("getSecureDelivery — rhodes_link", () => {
  it("generates a long random token + future expiry and emails a link (no attachment)", async () => {
    process.env.SECURE_DELIVERY_PROVIDER = "rhodes_link";
    const getSecureDelivery = await freshFactory();
    const result = await getSecureDelivery().send(baseInput);

    expect(result.provider).toBe("rhodes_link");
    expect(result.status).toBe("sent");
    expect(result.share_token).toBeTruthy();
    // 32 bytes base64url ≈ 43 chars.
    expect((result.share_token ?? "").length).toBeGreaterThanOrEqual(40);
    expect(new Date(result.expires_at!).getTime()).toBeGreaterThan(Date.now());

    // Emailed a link, never an attachment.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = sendEmailMock.mock.calls[0][0];
    expect(arg.to).toBe("cpa@andersen.com");
    expect(arg).not.toHaveProperty("attachments");
    expect(arg.html).toContain(`/share/${result.share_token}`);

    // Never downloads bytes at send time.
    // (getFileBuffer would throw if called with a real download; here it's a stub,
    //  but the link path must not invoke it.)
  });

  it("does not fetch file bytes at send time", async () => {
    process.env.SECURE_DELIVERY_PROVIDER = "rhodes_link";
    const getBuffer = vi.fn(async () => Buffer.from("x"));
    const getSecureDelivery = await freshFactory();
    await getSecureDelivery().send({
      ...baseInput,
      documents: [{ filename: "k1.pdf", mimeType: "application/pdf", getBuffer }],
    });
    expect(getBuffer).not.toHaveBeenCalled();
  });

  it("lists multiple documents in one email + link", async () => {
    process.env.SECURE_DELIVERY_PROVIDER = "rhodes_link";
    const getSecureDelivery = await freshFactory();
    const result = await getSecureDelivery().send({
      ...baseInput,
      documents: [
        { filename: "k1.pdf", mimeType: "application/pdf", getBuffer: async () => Buffer.from("a") },
        { filename: "financials.pdf", mimeType: "application/pdf", getBuffer: async () => Buffer.from("b") },
      ],
    });
    expect(result.status).toBe("sent");
    const arg = sendEmailMock.mock.calls[0][0];
    expect(arg.html).toContain("k1.pdf");
    expect(arg.html).toContain("financials.pdf");
    expect(arg.html).toContain("2 documents");
    expect(arg.subject).toContain("2 documents");
  });

  it("reports failed (but keeps the token) when the notification email fails", async () => {
    sendEmailMock.mockResolvedValueOnce({ error: "email_not_configured" });
    process.env.SECURE_DELIVERY_PROVIDER = "rhodes_link";
    const getSecureDelivery = await freshFactory();
    const result = await getSecureDelivery().send(baseInput);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("email_not_configured");
    expect(result.share_token).toBeTruthy();
  });
});
