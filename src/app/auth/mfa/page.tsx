"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Post-login MFA challenge interstitial. Login is Google OAuth only, so the
 * MFA challenge can't happen "after the password" — it happens here, after the
 * callback, when the user has a verified factor but their session is still aal1.
 * On success the session is reissued at aal2 and we return to the app.
 *
 * If the user has no factor (nothing to challenge) or is already aal2, we bounce
 * straight through — this page is a no-op for them.
 */
function MfaChallengeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/home";

  const [phase, setPhase] = useState<"checking" | "totp" | "sms" | "sending" | "done">("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Decide what to show: already-aal2 / no-factor → skip; else start a challenge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      // Already stepped up, or no factor to step up to → leave.
      if (aal?.currentLevel === "aal2" || aal?.nextLevel !== "aal2") {
        router.replace(next);
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = (factors?.totp ?? []).find((f) => f.status === "verified");
      const phone = (factors?.phone ?? []).find((f) => f.status === "verified");
      const factor = totp ?? phone;
      if (!factor) {
        router.replace(next);
        return;
      }
      setFactorId(factor.id);
      if (totp) {
        const { data: ch, error: err } = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (err || !ch) { setError(err?.message ?? "Could not start the security check."); return; }
        setChallengeId(ch.id);
        setPhase("totp");
      } else {
        // Phone: sending the challenge dispatches the SMS.
        const { data: ch, error: err } = await supabase.auth.mfa.challenge({ factorId: factor.id, channel: "sms" });
        if (err || !ch) { setError(err?.message ?? "Could not send the code."); return; }
        setChallengeId(ch.id);
        setPhase("sms");
      }
    })();
    return () => { cancelled = true; };
  }, [router, next]);

  const verify = useCallback(async () => {
    if (!factorId || !challengeId || code.length !== 6) return;
    setVerifying(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (err) { setError(err.message); setVerifying(false); return; }
      setPhase("done");
      router.replace(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
      setVerifying(false);
    }
  }, [factorId, challengeId, code, router, next]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#faf9f6", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", border: "1px solid #e8e6df", borderRadius: 12, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1f", margin: "0 0 6px" }}>Two-factor verification</h1>
        <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 20px", lineHeight: 1.5 }}>
          {phase === "checking" && "Checking your security settings…"}
          {phase === "totp" && "Enter the 6-digit code from your authenticator app."}
          {phase === "sms" && "Enter the 6-digit code we texted to your phone."}
          {phase === "done" && "Verified — taking you in…"}
        </p>

        {(phase === "totp" || phase === "sms") && (
          <>
            <input
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter") void verify(); }}
              placeholder="000000"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 22, letterSpacing: 8, textAlign: "center", padding: "12px 14px", border: "1px solid #d0d0d8", borderRadius: 8, marginBottom: 14 }}
            />
            <button
              onClick={() => void verify()}
              disabled={code.length !== 6 || verifying}
              style={{ width: "100%", background: code.length === 6 && !verifying ? "#2d5a3d" : "#a9b7ae", color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 500, cursor: code.length === 6 && !verifying ? "pointer" : "default" }}
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
          </>
        )}

        {error && (
          <p style={{ marginTop: 14, fontSize: 13, color: "#c0392b" }}>{error}</p>
        )}
      </div>
    </div>
  );
}

export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengeInner />
    </Suspense>
  );
}
