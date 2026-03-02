"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProcessingView } from "@/components/pipeline/ProcessingView";

export default function OnboardingProgressPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const router = useRouter();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    async function fetchEntities() {
      try {
        const res = await fetch("/api/entities");
        if (res.ok) {
          const data = await res.json();
          setEntities(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      } catch { /* ignore */ }
    }
    fetchEntities();
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginBottom: 4 }}>
          Processing Your Documents
        </div>
        <p style={{ fontSize: 13, color: "#6b6b76" }}>
          AI is analyzing your documents and extracting entity information.
        </p>
      </div>

      <ProcessingView
        batchId={batchId}
        entities={entities}
        onComplete={() => router.push("/entities")}
      />

      <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
        <Button variant="primary" onClick={() => router.push("/entities")} style={{ padding: "12px 28px", fontSize: 14 }}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
