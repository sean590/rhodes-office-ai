import { describe, it, expect } from "vitest";
import { friendlyProcessingError } from "../error-copy";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("friendlyProcessingError", () => {
  it("never leaks a storage URL or UUID from a download failure", () => {
    const raw = 'Failed to download file: {"url":"https://flcrgrtrguulaeupyaza.supabase.co/storage/v1/object/documents/12b411c8-1111-2222-3333-444455556666/queue/1830159e-1111-2222-3333-444455556666/split/233aaad5-1111-2222-3333-444455556666/2-distribution_notice.pdf"}';
    const out = friendlyProcessingError(raw);
    expect(out).toBe("Couldn't access the source file — it may have been moved. Retry?");
    expect(out).not.toContain("http");
    expect(out).not.toMatch(UUID);
  });

  it("never leaks the org UUID / request id from a rate-limit error", () => {
    const raw = '{"type":"error","error":{"type":"rate_limit_error","message":"429"},"org":"433f55e6-aaaa-bbbb-cccc-1234567890ab","request_id":"req_011CabcdEFGH"}';
    const out = friendlyProcessingError(raw);
    expect(out).toMatch(/rate limit/i);
    expect(out).not.toMatch(UUID);
    expect(out).not.toContain("request_id");
  });

  it("preserves the worker's large-document message", () => {
    const raw = "This document is too large to process (412 pages). Try uploading individual sections instead.";
    expect(friendlyProcessingError(raw)).toBe(raw);
  });

  it("maps a generic too-long error to friendly copy", () => {
    expect(friendlyProcessingError("prompt is too long: 250000 tokens")).toMatch(/too large/i);
  });

  it("passes through an already-clean plain-sentence error", () => {
    const raw = "The file appears to be corrupt and could not be read.";
    expect(friendlyProcessingError(raw)).toBe(raw);
  });

  it("falls back to generic copy for empty / jargon-only input", () => {
    expect(friendlyProcessingError(null)).toMatch(/something went wrong/i);
    expect(friendlyProcessingError("")).toMatch(/something went wrong/i);
    expect(friendlyProcessingError('{"code":500}')).toMatch(/something went wrong/i);
  });

  it("is idempotent (safe to apply at worker + render layers)", () => {
    const inputs = [
      'Failed to download file: {"url":"https://x.supabase.co/a/b-1111-2222.pdf"}',
      '{"error":{"type":"rate_limit_error"}}',
      "This document is password-protected.",
    ];
    for (const i of inputs) {
      const once = friendlyProcessingError(i);
      expect(friendlyProcessingError(once)).toBe(once);
    }
  });
});
