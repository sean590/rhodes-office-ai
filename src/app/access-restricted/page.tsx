"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AccessRestrictedContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const emailParam = searchParams.get("email");
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;

    setSubmitting(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "login_attempt" }),
      });
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f4f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 16,
          padding: "48px 40px",
          maxWidth: 440,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "#f0eeea",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
            fontSize: 22,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2d5a3d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "#1a1a1f",
            margin: "0 0 8px",
          }}
        >
          Rhodes is in early access
        </h1>

        <p
          style={{
            fontSize: 15,
            color: "#6b6b76",
            margin: "0 0 32px",
            lineHeight: 1.5,
          }}
        >
          We&apos;re onboarding new users gradually. Join the waitlist and
          we&apos;ll reach out when it&apos;s your turn.
        </p>

        {submitted ? (
          <div
            style={{
              padding: "16px 20px",
              background: "#f0f7f2",
              borderRadius: 10,
              color: "#2d5a3d",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            You&apos;re on the list. We&apos;ll be in touch.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid #ddd9d0",
                fontSize: 15,
                color: "#1a1a1f",
                background: "#ffffff",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                padding: "12px 20px",
                borderRadius: 10,
                border: "none",
                background: "#2d5a3d",
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Joining..." : "Join Waitlist"}
            </button>
          </form>
        )}

        <a
          href="https://rhodesoffice.ai"
          style={{
            display: "inline-block",
            marginTop: 24,
            fontSize: 14,
            color: "#6b6b76",
            textDecoration: "none",
          }}
        >
          Back to Home
        </a>
      </div>
    </div>
  );
}

export default function AccessRestrictedPage() {
  return (
    <Suspense>
      <AccessRestrictedContent />
    </Suspense>
  );
}
