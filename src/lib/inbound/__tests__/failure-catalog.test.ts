import { describe, it, expect } from "vitest";
import { DEFICIENCY_CODES, hostOf, type FailureCode } from "../failure-catalog";

describe("failure-catalog", () => {
  it("hostOf extracts a lowercased hostname, strips path/token", () => {
    expect(hostOf("https://Vault.ShareFile.com/d/secret-token")).toBe("vault.sharefile.com");
    expect(hostOf("https://x.safesendreturns.com/SendLinkRedirect/abc")).toBe("x.safesendreturns.com");
  });

  it("hostOf is null-safe on junk / missing input", () => {
    expect(hostOf(null)).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });

  it("deficiency set = failures we could fix by building (excludes by-design/environmental)", () => {
    // These are 'go build something' signals.
    for (const c of ["portal_unsupported", "delivery_unfetched", "safesend_nav_failed", "safesend_exhausted", "attachment_unreadable", "handler_exception"] as FailureCode[]) {
      expect(DEFICIENCY_CODES.has(c)).toBe(true);
    }
    // These are protective / user-side / upstream — NOT a bug backlog.
    for (const c of ["otp_awaiting", "sender_unverified", "flood_cap_held", "safesend_locked", "link_expired", "recipient_mismatch"] as FailureCode[]) {
      expect(DEFICIENCY_CODES.has(c)).toBe(false);
    }
  });
});
