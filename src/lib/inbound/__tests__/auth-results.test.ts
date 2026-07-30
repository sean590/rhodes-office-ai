import { describe, it, expect } from "vitest";
import { evaluateAuthResults } from "../gmail";

// Real-shaped Authentication-Results values (as Gmail's MX writes them). The
// hardening gate trusts `verified` to decide whether an attachment auto-files,
// so these assert the exact pass/fail boundaries.
describe("evaluateAuthResults", () => {
  it("clean pass (spf+dkim+dmarc all pass) → verified", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=pass header.i=@ridgecap.com header.s=s1 header.b=abc; " +
        "spf=pass (google.com: domain of bounce@ridgecap.com designates 1.2.3.4 as permitted sender) " +
        "smtp.mailfrom=bounce@ridgecap.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=ridgecap.com",
    );
    expect(r).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass", verified: true });
  });

  it("dmarc=fail → NOT verified even if spf passes", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=fail header.i=@evil.example; spf=pass smtp.mailfrom=evil.example; " +
        "dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=ridgecap.com",
    );
    expect(r.dmarc).toBe("fail");
    expect(r.verified).toBe(false);
  });

  it("spf pass + dkim fail + no dmarc token → NOT verified (needs both, or dmarc)", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=fail header.i=@example.com; spf=pass smtp.mailfrom=example.com",
    );
    expect(r).toEqual({ spf: "pass", dkim: "fail", dmarc: null, verified: false });
  });

  it("spf pass + dkim pass, dmarc absent → verified (both-pass path)", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=example.com",
    );
    expect(r.verified).toBe(true);
  });

  it("dmarc pass alone (spf softfail) → verified (DMARC implies alignment)", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=pass header.i=@example.com; spf=softfail; dmarc=pass header.from=example.com",
    );
    expect(r.verified).toBe(true);
  });

  it("missing header (empty string) → all null, fail CLOSED", () => {
    const r = evaluateAuthResults("");
    expect(r).toEqual({ spf: null, dkim: null, dmarc: null, verified: false });
  });

  it("spf=none / dkim=none / dmarc=none → NOT verified", () => {
    const r = evaluateAuthResults("mx.google.com; dkim=none; spf=none; dmarc=none");
    expect(r.verified).toBe(false);
  });

  it("case-insensitive verdict tokens", () => {
    const r = evaluateAuthResults("mx.google.com; DKIM=Pass; SPF=Pass; DMARC=Pass header.from=x.com");
    expect(r.verified).toBe(true);
  });

  it("temperror/permerror (DNS hiccup) → not a pass, fail closed", () => {
    const r = evaluateAuthResults("mx.google.com; dkim=temperror; spf=permerror; dmarc=temperror");
    expect(r.verified).toBe(false);
    expect(r.dmarc).toBe("temperror");
  });
});
