"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";

export default function OnboardingPage() {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"org" | "welcome" | "upload">("org");
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgError, setOrgError] = useState("");

  // Check if user already has an org
  useEffect(() => {
    async function checkOrg() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const user = await res.json();
          if (user.orgId) {
            // Already has org, skip to welcome
            setPhase("welcome");
          } else if (user.display_name) {
            // Pre-fill org name
            const firstName = user.display_name.split(" ")[0];
            setOrgName(`${firstName}'s Organization`);
          }
        }
      } catch { /* ignore */ }
    }
    checkOrg();
  }, []);

  // Create batch when entering upload phase
  useEffect(() => {
    if (phase !== "upload" || batchId) return;

    async function createBatch() {
      try {
        const res = await fetch("/api/pipeline/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "onboarding",
            entity_discovery: true,
            name: "Onboarding Upload",
          }),
        });
        if (res.ok) {
          const batch = await res.json();
          setBatchId(batch.id);
        }
      } catch { /* ignore */ }
    }

    createBatch();
  }, [phase, batchId]);

  const handleCreateOrg = async () => {
    const trimmed = orgName.trim();
    if (!trimmed) {
      setOrgError("Please enter a name for your organization.");
      return;
    }
    setCreatingOrg(true);
    setOrgError("");

    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const err = await res.json();
        setOrgError(err.error || "Failed to create organization.");
        return;
      }

      setPhase("welcome");
    } catch {
      setOrgError("Something went wrong. Please try again.");
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleFilesUploaded = async () => {
    if (!batchId) return;
    // Trigger processing immediately and navigate to progress page
    try {
      await fetch(`/api/pipeline/batches/${batchId}/process`, { method: "POST" });
    } catch { /* ignore */ }
    router.push(`/onboarding/${batchId}/progress`);
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      {/* Org Creation Phase */}
      {phase === "org" && (
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1f", marginBottom: 12 }}>
            Name Your Organization
          </div>
          <p style={{ fontSize: 15, color: "#6b6b76", maxWidth: 500, margin: "0 auto 32px", lineHeight: 1.6 }}>
            An organization is how Rhodes groups your entities, documents, and team. You can invite others to collaborate later.
          </p>
          <div style={{ maxWidth: 400, margin: "0 auto 16px" }}>
            <input
              type="text"
              value={orgName}
              onChange={(e) => { setOrgName(e.target.value); setOrgError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
              placeholder="e.g. Doherty Family Office"
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 15,
                border: "1px solid #ddd9d0",
                borderRadius: 8,
                outline: "none",
                background: "#fff",
                color: "#1a1a1f",
              }}
              autoFocus
            />
            {orgError && (
              <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8, textAlign: "left" }}>
                {orgError}
              </div>
            )}
          </div>
          <Button
            variant="primary"
            onClick={handleCreateOrg}
            disabled={creatingOrg}
            style={{ padding: "12px 28px", fontSize: 14 }}
          >
            {creatingOrg ? "Creating..." : "Continue"}
          </Button>
        </div>
      )}

      {/* Welcome Phase */}
      {phase === "welcome" && (
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1f", marginBottom: 12 }}>
            Welcome to Rhodes
          </div>
          <p style={{ fontSize: 15, color: "#6b6b76", maxWidth: 500, margin: "0 auto 32px", lineHeight: 1.6 }}>
            Let&#39;s get your world into Rhodes. Upload your entity documents and we&#39;ll automatically identify entities, extract key data, and organize everything for you.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Button variant="primary" onClick={() => setPhase("upload")} style={{ padding: "12px 28px", fontSize: 14 }}>
              Upload Documents
            </Button>
            <Button onClick={() => router.push("/entities")} style={{ padding: "12px 28px", fontSize: 14 }}>
              Skip to Dashboard
            </Button>
          </div>
        </div>
      )}

      {/* Upload Phase */}
      {phase === "upload" && batchId && (
        <div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginBottom: 4 }}>
              Upload Your Documents
            </div>
            <p style={{ fontSize: 13, color: "#6b6b76" }}>
              Drop operating agreements, tax returns, K-1s, insurance certificates — anything related to your entities. We&#39;ll figure out the rest.
            </p>
          </div>

          <UploadDropZone
            batchId={batchId}
            onFilesUploaded={handleFilesUploaded}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Button onClick={() => router.push("/entities")}>
              Skip to Dashboard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
