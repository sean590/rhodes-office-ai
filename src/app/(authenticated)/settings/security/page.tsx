"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import { MfaSection } from "@/components/settings/mfa-section";
import { SectionCard } from "@/components/settings/section-card";

export default function SettingsSecurityPage() {
  const isMobile = useIsMobile();

  return (
    <div>
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
