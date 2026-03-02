"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";

export default function OnboardingPage() {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"welcome" | "upload">("welcome");

  // Create batch on mount
  useEffect(() => {
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
  }, []);

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
