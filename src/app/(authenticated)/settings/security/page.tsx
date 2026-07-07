"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MfaSection } from "@/components/settings/mfa-section";
import { SectionCard } from "@/components/settings/section-card";

export default function SettingsSecurityPage() {
  const isMobile = useIsMobile();
  // Read ?reason=mfa_required from location (not useSearchParams — that forces a
  // CSR bailout / Suspense requirement on this route).
  const [mfaRequired, setMfaRequired] = useState(false);
  useEffect(() => {
    setMfaRequired(new URLSearchParams(window.location.search).get("reason") === "mfa_required");
  }, []);

  return (
    <div>
      {mfaRequired && (
        <div
          style={{
            background: "rgba(45,90,61,0.08)",
            border: "1px solid rgba(45,90,61,0.2)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            color: "#2d5a3d",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Two-factor authentication is required.</strong> Enroll a factor below
          to continue using Rhodes.
        </div>
      )}
      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <h1
          style={{
            fontSize: isMobile ? 20 : 22,
            fontWeight: 600,
            color: "#1a1a1f",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Security
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Two-factor authentication and session settings
        </p>
      </div>

      <SectionCard
        title="Two-factor authentication"
        subtitle="Add a second step to sign-in for stronger protection"
        isMobile={isMobile}
      >
        <MfaSection isMobile={isMobile} />
      </SectionCard>
    </div>
  );
}
