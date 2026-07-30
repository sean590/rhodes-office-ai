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

  it("spf pass + dkim fail + no dmarc → verified (SPF aligned, DMARC didn't fail)", () => {
    // dkim can break in transit (forwarding); a passing SPF with no DMARC fail
    // is enough to auto-file.
    const r = evaluateAuthResults(
      "mx.google.com; dkim=fail header.i=@example.com; spf=pass smtp.mailfrom=example.com",
    );
    expect(r).toEqual({ spf: "pass", dkim: "fail", dmarc: null, verified: true });
  });

  it("REAL forwarded-mail shape (spf=none, dkim=pass, no dmarc) → verified — the false-hold bug", () => {
    // Exact Authentication-Results Gmail wrote for Sean's forwards: Workspace
    // DKIM via a gappssmtp.com delegate, channels.com has no SPF/DMARC. Must
    // file, or the "forward it to Rhodes" front door holds every forward.
    const r = evaluateAuthResults(
      "mx.google.com; dkim=pass header.i=@channels-com.20251104.gappssmtp.com header.s=20251104 header.b=SadtcIyp; " +
        "arc=pass (i=1); spf=none (google.com: sean@channels.com does not designate permitted sender hosts) " +
        "smtp.mailfrom=sean@channels.com",
    );
    expect(r).toEqual({ spf: "none", dkim: "pass", dmarc: null, verified: true });
  });

  it("dmarc=fail overrides a passing dkim → NOT verified (spoof of a DMARC domain)", () => {
    const r = evaluateAuthResults(
      "mx.google.com; dkim=pass header.i=@attacker.example; spf=pass smtp.mailfrom=attacker.example; " +
        "dmarc=fail (p=REJECT) header.from=bigfirm.com",
    );
    expect(r.verified).toBe(false);
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
