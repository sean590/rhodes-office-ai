"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";
import {
  DocumentRulesSection,
  DocumentProfilesSection,
} from "@/components/settings/document-rules-section";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

interface CurrentUserInfo {
  id: string;
  orgRole?: string;
}

interface DetectedPattern {
  id: string;
  pattern_type: string;
  document_type: string;
  document_category: string;
  description: string;
  evidence: { entities_with?: string[]; entities_without?: string[] };
  confidence: number;
  entity_coverage: number;
  times_confirmed: number;
  times_dismissed: number;
  promoted_to_template_id: string | null;
}

interface InferenceResult {
  patterns_found: number;
  diagnostics: {
    cross_entity: number;
    annual_recurrence: number;
    lifecycle: number;
    service_provider: number;
    suggestions_created: number;
    entities_scanned: number;
    documents_scanned: number;
  };
}

export default function SettingsDocumentsPage() {
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>([]);
  const [patternEntityNames, setPatternEntityNames] = useState<Record<string, string>>({});
  const [patternsLoaded, setPatternsLoaded] = useState(false);
  const [runningInference, setRunningInference] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
    } catch { /* ignore */ }
  }, []);

  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch("/api/patterns");
      if (!res.ok) return;
      const data = await res.json();
      setDetectedPatterns(data.patterns || []);
      setPatternEntityNames(data.entityNames || {});
    } catch { /* non-critical */ }
    setPatternsLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([fetchCurrentUser(), fetchPatterns()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCurrentUser, fetchPatterns]);

  if (loading) {
    return (
      <div style={{ padding: 80, color: "#9494a0", fontSize: 13, textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  const isOwner = currentUser?.orgRole === "owner";

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
          Document requirements
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Document requirements per entity type and AI-detected patterns
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
        <SectionCard
          title="Document Requirements (Org-wide)"
          subtitle="Disable a document type org-wide to suppress it for every entity"
          isMobile={isMobile}
        >
          <DocumentRulesSection isMobile={isMobile} />
        </SectionCard>

        <SectionCard
          title="Document Requirements by Entity Type"
          subtitle="Control which documents apply to each entity type and add custom requirements"
          isMobile={isMobile}
        >
          <DocumentProfilesSection isMobile={isMobile} />
        </SectionCard>

        {patternsLoaded && (
          <SectionCard
            title="Detected Patterns"
            subtitle="AI-detected document patterns across your entities"
            isMobile={isMobile}
            headerRight={
              <button
                onClick={async () => {
                  setRunningInference(true);
                  setInferenceResult(null);
                  try {
                    const res = await fetch("/api/patterns", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "run" }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setInferenceResult(data);
                    }
                    await fetchPatterns();
                  } catch { /* ignore */ }
                  setRunningInference(false);
                }}
                disabled={runningInference}
                style={{
                  background: runningInference ? "#e8e6df" : "rgba(45,90,61,0.08)",
                  color: runningInference ? "#9494a0" : "#2d5a3d",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: runningInference ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {runningInference ? "Analyzing..." : "Run Analysis"}
              </button>
            }
          >
            {runningInference && (
              <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 28, height: 28, border: "3px solid #e8e6df", borderTopColor: "#2d5a3d",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite",
                }} />
                <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                  Scanning documents and entities...
                </div>
                <div style={{ fontSize: 12, color: "#9494a0" }}>
                  This may take a moment depending on the size of your organization.
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {!runningInference && inferenceResult && (
              <div style={{
                padding: "12px 16px", margin: "0 0 12px", background: "rgba(45,90,61,0.04)",
                borderRadius: 8, border: "1px solid rgba(45,90,61,0.12)",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2d5a3d", marginBottom: 6 }}>
                  Analysis Complete
                </div>
                <div style={{ fontSize: 12, color: "#6b6b76", lineHeight: 1.6 }}>
                  Scanned {inferenceResult.diagnostics.entities_scanned} entities and {inferenceResult.diagnostics.documents_scanned} documents.
                  {inferenceResult.patterns_found > 0 ? (
                    <> Found <strong>{inferenceResult.patterns_found} pattern{inferenceResult.patterns_found !== 1 ? "s" : ""}</strong> and created {inferenceResult.diagnostics.suggestions_created} suggestion{inferenceResult.diagnostics.suggestions_created !== 1 ? "s" : ""}.</>
                  ) : (
                    <> No new patterns detected. As you upload more documents, Rhodes will identify trends across your entities.</>
                  )}
                </div>
                {inferenceResult.patterns_found > 0 && (
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 6 }}>
                    Cross-entity: {inferenceResult.diagnostics.cross_entity} &middot; Annual: {inferenceResult.diagnostics.annual_recurrence} &middot; Lifecycle: {inferenceResult.diagnostics.lifecycle} &middot; Service provider: {inferenceResult.diagnostics.service_provider}
                  </div>
                )}
              </div>
            )}

            {!runningInference && detectedPatterns.length === 0 && !inferenceResult && (
              <div style={{ padding: 20, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
                No patterns detected yet. Click &quot;Run Analysis&quot; to scan your documents for patterns.
              </div>
            )}

            {!runningInference && detectedPatterns.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 0 8px" }}>
                {detectedPatterns.map((p) => {
                  const missingNames = (p.evidence.entities_without || [])
                    .map((eid) => patternEntityNames[eid])
                    .filter(Boolean);
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: "12px 16px",
                        borderRadius: 8,
                        border: "1px solid #e8e6df",
                        background: "#fafaf7",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", marginBottom: 4 }}>
                            {(DOCUMENT_TYPE_LABELS as Record<string, string>)[p.document_type] || p.document_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 6 }}>
                            {p.description}
                          </div>
                          {missingNames.length > 0 && (
                            <div style={{ fontSize: 11, color: "#c47520" }}>
                              Missing from: {missingNames.join(", ")}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500 }}>
                            {Math.round(p.confidence * 100)}%
                          </span>
                          {!p.promoted_to_template_id && isOwner && (
                            <>
                              <button
                                onClick={async () => {
                                  if (!confirm("Promote this pattern to an org-wide template? This will add it as a checklist item for all matching entities.")) return;
                                  await fetch("/api/patterns", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "promote", pattern_id: p.id }),
                                  });
                                  await fetchPatterns();
                                }}
                                style={{
                                  background: "rgba(45,90,61,0.08)",
                                  color: "#2d5a3d",
                                  border: "none",
                                  borderRadius: 4,
                                  padding: "3px 10px",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                }}
                              >
                                Create Template
                              </button>
                              <button
                                onClick={async () => {
                                  await fetch("/api/patterns", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "dismiss", pattern_id: p.id }),
                                  });
                                  await fetchPatterns();
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  fontSize: 11,
                                  color: "#9494a0",
                                  cursor: "pointer",
                                  padding: "2px 6px",
                                  fontFamily: "inherit",
                                }}
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                          {p.promoted_to_template_id && (
                            <span style={{ fontSize: 11, color: "#2d5a3d", fontWeight: 500 }}>
                              Promoted
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
