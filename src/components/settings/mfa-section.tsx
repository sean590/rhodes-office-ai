"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";

type MfaStep = "idle" | "enrolling" | "verifying" | "enabled";

interface MfaFactor {
  id: string;
  factor_type: string;
  status: string;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function MfaSection({ isMobile }: { isMobile: boolean }) {
  const [step, setStep] = useState<MfaStep>("idle");
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const fetchFactors = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase.auth.mfa.listFactors();
      if (fetchErr) {
        console.error("[MFA] Failed to list factors:", fetchErr);
        return;
      }
      const totp = (data?.totp || []).filter((f) => f.status === "verified");
      setFactors(totp);
      if (totp.length > 0) {
        setStep("enabled");
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFactors();
  }, [fetchFactors]);

  const startEnrollment = async () => {
    setError(null);
    setStep("enrolling");
    try {
      const supabase = getSupabase();
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Rhodes Authenticator",
      });
      if (enrollErr || !data) {
        setError(enrollErr?.message || "Failed to start enrollment");
        setStep("idle");
        return;
      }
      setQrCode(data.totp.qr_code);
      setFactorId(data.id);
      setStep("verifying");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
      setStep("idle");
    }
  };

  const verifyEnrollment = async () => {
    if (!factorId || verifyCode.length !== 6) return;
    setError(null);
    try {
      const supabase = getSupabase();
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeErr || !challenge) {
        setError(challengeErr?.message || "Challenge failed");
        return;
      }
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: verifyCode,
      });
      if (verifyErr) {
        setError(verifyErr.message);
        return;
      }
      setStep("enabled");
      setQrCode(null);
      setVerifyCode("");
      fetchFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  };

  const disableMfa = async (fId: string) => {
    setDisabling(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: fId,
      });
      if (unenrollErr) {
        setError(unenrollErr.message);
        return;
      }
      setStep("idle");
      setFactors([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable MFA");
    } finally {
      setDisabling(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 16, color: "#9494a0", fontSize: 13 }}>
        Loading security settings...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: step === "enabled" ? "#2d5a3d" : "#ddd9d0",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
            Two-Factor Authentication (TOTP)
          </span>
        </div>
        <p style={{ fontSize: 12, color: "#9494a0", margin: "0 0 0 16px" }}>
          {step === "enabled"
            ? "MFA is enabled. Your account is protected with an authenticator app."
            : "Add an extra layer of security by requiring a code from an authenticator app."}
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(220,38,38,0.08)",
            color: "#dc2626",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Idle — show enable button */}
      {step === "idle" && (
        <button
          onClick={startEnrollment}
          style={{
            background: "#2d5a3d",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Enable Two-Factor Authentication
        </button>
      )}

      {/* Enrolling — loading state */}
      {step === "enrolling" && (
        <div style={{ padding: 16, color: "#9494a0", fontSize: 13 }}>
          Setting up authenticator...
        </div>
      )}

      {/* Verifying — show QR code and verify input */}
      {step === "verifying" && qrCode && (
        <div
          style={{
            border: "1px solid #e8e6df",
            borderRadius: 8,
            padding: isMobile ? 16 : 20,
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "#1a1a1f",
              margin: "0 0 16px 0",
              lineHeight: 1.5,
            }}
          >
            Scan this QR code with your authenticator app (Google Authenticator,
            Authy, 1Password, etc.), then enter the 6-digit code below.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              gap: 20,
              alignItems: isMobile ? "center" : "flex-start",
            }}
          >
            <div
              dangerouslySetInnerHTML={{ __html: qrCode }}
              style={{
                width: 200,
                height: 200,
                background: "#fff",
                borderRadius: 8,
                padding: 8,
                border: "1px solid #e8e6df",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, width: isMobile ? "100%" : "auto" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#6b6b76",
                  marginBottom: 6,
                }}
              >
                Verification Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) =>
                  setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                style={{
                  width: "100%",
                  maxWidth: 180,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #ddd9d0",
                  fontSize: 18,
                  fontFamily: "monospace",
                  letterSpacing: 4,
                  textAlign: "center",
                  outline: "none",
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <button
                  onClick={verifyEnrollment}
                  disabled={verifyCode.length !== 6}
                  style={{
                    background:
                      verifyCode.length === 6 ? "#2d5a3d" : "#ddd9d0",
                    color: verifyCode.length === 6 ? "#fff" : "#9494a0",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor:
                      verifyCode.length === 6 ? "pointer" : "not-allowed",
                  }}
                >
                  Verify & Enable
                </button>
                <button
                  onClick={() => {
                    setStep("idle");
                    setQrCode(null);
                    setVerifyCode("");
                    setError(null);
                  }}
                  style={{
                    background: "none",
                    color: "#6b6b76",
                    border: "1px solid #ddd9d0",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enabled — show status and disable button */}
      {step === "enabled" && factors.length > 0 && (
        <div>
          {factors.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid #f0eeea",
              }}
            >
              <div style={{ fontSize: 13, color: "#1a1a1f" }}>
                Authenticator App
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    color: "#2d5a3d",
                    fontWeight: 500,
                    background: "rgba(45,90,61,0.08)",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  Active
                </span>
              </div>
              <button
                onClick={() => disableMfa(f.id)}
                disabled={disabling}
                style={{
                  background: "none",
                  color: "#dc2626",
                  border: "1px solid rgba(220,38,38,0.2)",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  cursor: disabling ? "not-allowed" : "pointer",
                  opacity: disabling ? 0.5 : 1,
                }}
              >
                {disabling ? "Disabling..." : "Disable"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
