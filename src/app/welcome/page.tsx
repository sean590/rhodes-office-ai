"use client";

import { useEffect, useState } from "react";

const ENTITY_OPTIONS = [
  { value: "1", label: "Just 1" },
  { value: "2-5", label: "2–5" },
  { value: "6-15", label: "6–15" },
  { value: "16+", label: "16+" },
] as const;

const ROLE_OPTIONS = [
  { value: "family_office_principal", label: "Family office (principal / family)" },
  { value: "family_office_staff", label: "Family office staff" },
  { value: "advisor", label: "Wealth advisor / RIA" },
  { value: "accountant", label: "Accountant / CPA" },
  { value: "other", label: "Other" },
] as const;

export default function WelcomePage() {
  const [orgName, setOrgName] = useState("");
  const [entityCount, setEntityCount] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user already has an org (double-open / back button), skip onboarding.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me?.orgId) window.location.href = "/home";
      })
      .catch(() => {});
  }, []);

  const canSubmit = orgName.trim() && entityCount && role && agreed && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/signup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName: orgName.trim(), entityCount, role, agreedToTerms: true }),
      });
      if (res.status === 409) {
        window.location.href = "/home";
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Something went wrong. Please try again.");
      }
      window.location.href = "/home";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#1a1a1f", display: "block", marginBottom: 8 };
  const pill = (active: boolean): React.CSSProperties => ({
    padding: "8px 14px",
    borderRadius: 999,
    border: `1px solid ${active ? "#2d5a3d" : "#e8e6df"}`,
    background: active ? "#eef3ef" : "#fff",
    color: active ? "#2d5a3d" : "#6b6b76",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f5f4f0", padding: 24 }}>
      <div className="w-full" style={{ maxWidth: 460, background: "#fff", border: "1px solid #e8e6df", borderRadius: 16, padding: 32 }}>
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold text-white" style={{ background: "linear-gradient(135deg, #2d5a3d, #3d7a53)" }}>
            R
          </div>
          <span className="text-lg font-semibold" style={{ letterSpacing: "-0.02em", color: "#1a1a1f" }}>Rhodes</span>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1f", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          Let&apos;s set up your workspace
        </h1>
        <p style={{ fontSize: 13.5, color: "#6b6b76", margin: "0 0 24px", lineHeight: 1.5 }}>
          Two quick questions, then you&apos;re in. Your 30-day trial starts now.
        </p>

        <div style={{ marginBottom: 20 }}>
          <label style={label} htmlFor="orgName">Workspace name</label>
          <input
            id="orgName"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Doherty Family Office"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e8e6df", fontSize: 14, fontFamily: "inherit" }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={label}>How many entities do you manage?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ENTITY_OPTIONS.map((o) => (
              <button key={o.value} type="button" style={pill(entityCount === o.value)} onClick={() => setEntityCount(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={label}>What best describes you?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ROLE_OPTIONS.map((o) => (
              <button key={o.value} type="button" style={pill(role === o.value)} onClick={() => setRole(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, color: "#6b6b76", lineHeight: 1.5, marginBottom: 20, cursor: "pointer" }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            I agree to the{" "}
            <a href="/legal/terms" target="_blank" style={{ color: "#2d5a3d", fontWeight: 600, textDecoration: "none" }}>Terms of Service</a>{" "}and{" "}
            <a href="/legal/privacy" target="_blank" style={{ color: "#2d5a3d", fontWeight: 600, textDecoration: "none" }}>Privacy Policy</a>.
          </span>
        </label>

        {error && <div style={{ fontSize: 13, color: "#c73e3e", marginBottom: 14 }}>{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "11px 18px",
            borderRadius: 8,
            border: "none",
            background: canSubmit ? "#2d5a3d" : "#e8e6df",
            color: canSubmit ? "#fff" : "#9494a0",
            fontSize: 14,
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          {submitting ? "Setting up…" : "Enter Rhodes"}
        </button>
      </div>
    </div>
  );
}
