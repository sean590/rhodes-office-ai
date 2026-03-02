"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";

type MfaStep = "idle" | "enrolling" | "verifying" | "enabled";
type PhoneStep = "idle" | "entering_phone" | "verifying_code" | "enabled";

interface MfaFactor {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
  phone?: string;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function MfaSection({ isMobile }: { isMobile: boolean }) {
  // TOTP state
  const [step, setStep] = useState<MfaStep>("idle");
  const [totpFactors, setTotpFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  // Phone state
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("idle");
  const [phoneFactors, setPhoneFactors] = useState<MfaFactor[]>([]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneFactorId, setPhoneFactorId] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSending, setPhoneSending] = useState(false);

  const fetchFactors = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase.auth.mfa.listFactors();
      if (fetchErr) {
        console.error("[MFA] Failed to list factors:", fetchErr);
        return;
      }
      const totp = (data?.totp || []).filter((f) => f.status === "verified");
      const phone = (data?.phone || []).filter((f) => f.status === "verified");
      setTotpFactors(totp);
      setPhoneFactors(phone);
      if (totp.length > 0) setStep("enabled");
      if (phone.length > 0) setPhoneStep("enabled");
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFactors();
  }, [fetchFactors]);

  // --- TOTP Methods ---

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
      setTotpSecret(data.totp.secret);
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
      const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId });
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
      setTotpSecret(null);
      setVerifyCode("");
      fetchFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  };

  // --- Phone Methods ---

  const startPhoneEnrollment = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      setPhoneError("Enter a valid phone number with country code (e.g. +1...)");
      return;
    }
    setPhoneError(null);
    setPhoneSending(true);
    try {
      const supabase = getSupabase();
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "phone",
        phone: phoneNumber,
        friendlyName: "Rhodes Phone",
      });
      if (enrollErr || !data) {
        setPhoneError(enrollErr?.message || "Failed to enroll phone");
        return;
      }
      setPhoneFactorId(data.id);
      // Send the challenge (SMS code)
      const { error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId: data.id,
        channel: "sms",
      });
      if (challengeErr) {
        setPhoneError(challengeErr.message);
        return;
      }
      setPhoneStep("verifying_code");
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Phone enrollment failed");
    } finally {
      setPhoneSending(false);
    }
  };

  const verifyPhoneEnrollment = async () => {
    if (!phoneFactorId || phoneCode.length !== 6) return;
    setPhoneError(null);
    try {
      const supabase = getSupabase();
      // Get the latest challenge
      const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: phoneFactorId, channel: "sms" });
      if (challengeErr || !challenge) {
        setPhoneError(challengeErr?.message || "Challenge failed");
        return;
      }
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: phoneFactorId,
        challengeId: challenge.id,
        code: phoneCode,
      });
      if (verifyErr) {
        setPhoneError(verifyErr.message);
        return;
      }
      setPhoneStep("enabled");
      setPhoneNumber("");
      setPhoneCode("");
      fetchFactors();
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Verification failed");
    }
  };

  // --- Shared disable ---

  const disableFactor = async (fId: string, type: "totp" | "phone") => {
    setDisabling(true);
    const setErr = type === "totp" ? setError : setPhoneError;
    setErr(null);
    try {
      const supabase = getSupabase();
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: fId,
      });
      if (unenrollErr) {
        setErr(unenrollErr.message);
        return;
      }
      if (type === "totp") {
        setStep("idle");
        setTotpFactors([]);
      } else {
        setPhoneStep("idle");
        setPhoneFactors([]);
      }
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Failed to disable");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ---- TOTP Section ---- */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: step === "enabled" ? "#2d5a3d" : "#ddd9d0",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
              Authenticator App (TOTP)
            </span>
          </div>
          <p style={{ fontSize: 12, color: "#9494a0", margin: "0 0 0 16px" }}>
            {step === "enabled"
              ? "Enabled — your account is protected with an authenticator app."
              : "Use an app like Google Authenticator, Authy, or 1Password to generate codes."}
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
            Enable Authenticator
          </button>
        )}

        {step === "enrolling" && (
          <div style={{ padding: 16, color: "#9494a0", fontSize: 13 }}>
            Setting up authenticator...
          </div>
        )}

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
              Scan this QR code with your authenticator app, then enter the
              6-digit code below.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                gap: 20,
                alignItems: isMobile ? "center" : "flex-start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCode}
                  alt="MFA QR Code"
                  style={{
                    width: 200,
                    height: 200,
                    borderRadius: 8,
                    border: "1px solid #e8e6df",
                  }}
                />
                {totpSecret && (
                  <div style={{ width: 200, textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: "#9494a0", margin: "4px 0 6px 0" }}>
                      Can&apos;t scan? Copy this code:
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(totpSecret);
                        setSecretCopied(true);
                        setTimeout(() => setSecretCopied(false), 2000);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "6px 8px",
                        background: "#f5f4f0",
                        border: "1px solid #ddd9d0",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        fontSize: 11,
                        letterSpacing: 1,
                        wordBreak: "break-all",
                        cursor: "pointer",
                        color: "#1a1a1f",
                        textAlign: "center",
                      }}
                      title="Click to copy"
                    >
                      {secretCopied ? "Copied!" : totpSecret}
                    </button>
                  </div>
                )}
              </div>
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
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    onClick={verifyEnrollment}
                    disabled={verifyCode.length !== 6}
                    style={{
                      background: verifyCode.length === 6 ? "#2d5a3d" : "#ddd9d0",
                      color: verifyCode.length === 6 ? "#fff" : "#9494a0",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: verifyCode.length === 6 ? "pointer" : "not-allowed",
                    }}
                  >
                    Verify & Enable
                  </button>
                  <button
                    onClick={() => {
                      setStep("idle");
                      setQrCode(null);
                      setTotpSecret(null);
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

        {step === "enabled" && totpFactors.length > 0 && (
          <div>
            {totpFactors.map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
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
                  onClick={() => disableFactor(f.id, "totp")}
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

      {/* Divider */}
      <div style={{ borderTop: "1px solid #e8e6df" }} />

      {/* ---- Phone Section ---- */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: phoneStep === "enabled" ? "#2d5a3d" : "#ddd9d0",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
              Phone (SMS)
            </span>
          </div>
          <p style={{ fontSize: 12, color: "#9494a0", margin: "0 0 0 16px" }}>
            {phoneStep === "enabled"
              ? "Enabled — verification codes will be sent via SMS."
              : "Receive a verification code via text message as a backup method."}
          </p>
        </div>

        {phoneError && (
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
            {phoneError}
          </div>
        )}

        {phoneStep === "idle" && (
          <button
            onClick={() => setPhoneStep("entering_phone")}
            style={{
              background: "#fff",
              color: "#1a1a1f",
              border: "1px solid #ddd9d0",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Enable Phone Verification
          </button>
        )}

        {phoneStep === "entering_phone" && (
          <div
            style={{
              border: "1px solid #e8e6df",
              borderRadius: 8,
              padding: isMobile ? 16 : 20,
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 500,
                color: "#6b6b76",
                marginBottom: 6,
              }}
            >
              Phone Number (with country code)
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 555 123 4567"
              style={{
                width: "100%",
                maxWidth: 240,
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #ddd9d0",
                fontSize: 14,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={startPhoneEnrollment}
                disabled={phoneSending || phoneNumber.length < 10}
                style={{
                  background:
                    phoneNumber.length >= 10 && !phoneSending
                      ? "#2d5a3d"
                      : "#ddd9d0",
                  color:
                    phoneNumber.length >= 10 && !phoneSending
                      ? "#fff"
                      : "#9494a0",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor:
                    phoneNumber.length >= 10 && !phoneSending
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                {phoneSending ? "Sending..." : "Send Code"}
              </button>
              <button
                onClick={() => {
                  setPhoneStep("idle");
                  setPhoneNumber("");
                  setPhoneError(null);
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
        )}

        {phoneStep === "verifying_code" && (
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
                margin: "0 0 12px 0",
              }}
            >
              Enter the 6-digit code sent to{" "}
              <strong>{phoneNumber}</strong>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={phoneCode}
              onChange={(e) =>
                setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))
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
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={verifyPhoneEnrollment}
                disabled={phoneCode.length !== 6}
                style={{
                  background: phoneCode.length === 6 ? "#2d5a3d" : "#ddd9d0",
                  color: phoneCode.length === 6 ? "#fff" : "#9494a0",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: phoneCode.length === 6 ? "pointer" : "not-allowed",
                }}
              >
                Verify & Enable
              </button>
              <button
                onClick={() => {
                  setPhoneStep("idle");
                  setPhoneCode("");
                  setPhoneNumber("");
                  setPhoneError(null);
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
        )}

        {phoneStep === "enabled" && phoneFactors.length > 0 && (
          <div>
            {phoneFactors.map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                }}
              >
                <div style={{ fontSize: 13, color: "#1a1a1f" }}>
                  Phone (SMS)
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
                  onClick={() => disableFactor(f.id, "phone")}
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
    </div>
  );
}
