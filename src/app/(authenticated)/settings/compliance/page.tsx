"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  ComplianceRulesSection,
  ComplianceProfilesSection,
} from "@/components/settings/compliance-rules-section";
import { SectionCard } from "@/components/settings/section-card";

export default function SettingsCompliancePage() {
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
          Compliance
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Org-wide rules and per-entity-type profiles
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
        <SectionCard
          title="Compliance Rules"
          subtitle="Enable or disable compliance rules across all entities"
          isMobile={isMobile}
        >
          <ComplianceRulesSection isMobile={isMobile} />
        </SectionCard>

        <SectionCard
          title="Compliance Profiles"
          subtitle="Control which rules apply to each entity type"
          isMobile={isMobile}
        >
          <ComplianceProfilesSection isMobile={isMobile} />
        </SectionCard>
      </div>
    </div>
  );
}
