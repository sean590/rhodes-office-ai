/**
 * Unit tests for the extended sendEmail — replyTo/cc passthrough and the
 * { id?, error? } return contract. The Resend client is mocked so no network
 * call happens. (sendEmail intentionally has NO attachment support — provider
 * documents go out via secure delivery, never as plaintext attachments.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the args passed to the mocked Resend client's emails.send.
const sendMock = vi.fn();

vi.mock("resend", () => ({
  // A class is always constructable — survives vi.resetModules() between tests.
  Resend: class {
    emails = { send: sendMock };
  },
}));

// getResend() requires the key to be present to build a client.
beforeEach(() => {
  vi.resetModules();
  sendMock.mockReset();
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "Rhodes <noreply@notify.rhodesoffice.ai>";
});

async function importSendEmail() {
  // Import after env + mocks are set so the module-level client picks them up.
  const mod = await import("../email");
  return mod.sendEmail;
}

describe("sendEmail — cover-note path", () => {
  it("passes replyTo and cc through to Resend and returns the id", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "resend-123" }, error: null });
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "cpa@andersen.com",
      subject: "909 Park K-1",
      html: "<p>note</p>",
      replyTo: "sean@channels.com",
      cc: "sean@channels.com",
    });

    expect(result).toEqual({ id: "resend-123" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe("cpa@andersen.com");
    expect(arg.replyTo).toBe("sean@channels.com");
    expect(arg.cc).toBe("sean@channels.com");
    // No attachment support — sendEmail never carries files.
    expect(arg).not.toHaveProperty("attachments");
  });

  it("omits replyTo/cc keys when not provided", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "resend-456" }, error: null });
    const sendEmail = await importSendEmail();

    await sendEmail({ to: "x@y.com", subject: "s", html: "<p>h</p>" });

    const arg = sendMock.mock.calls[0][0];
    expect(arg).not.toHaveProperty("attachments");
    expect(arg).not.toHaveProperty("replyTo");
    expect(arg).not.toHaveProperty("cc");
  });

  it("returns the error message when Resend reports an error", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "bad recipient" } });
    const sendEmail = await importSendEmail();

    const result = await sendEmail({ to: "bad", subject: "s", html: "<p>h</p>" });
    expect(result.error).toBe("bad recipient");
    expect(result.id).toBeUndefined();
  });

  it("returns an error (does not throw) when the API key is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const sendEmail = await importSendEmail();

    const result = await sendEmail({ to: "x@y.com", subject: "s", html: "<p>h</p>" });
    expect(result.error).toBe("email_not_configured");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
