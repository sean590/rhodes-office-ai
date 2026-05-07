"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ProcessingView } from "@/components/pipeline/ProcessingView";

interface BatchDetail {
  id: string;
  name: string | null;
  status: "staging" | "processing" | "review" | "completed";
  total_documents: number;
  metadata: Record<string, unknown> | null;
}

export default function BatchReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pipeline/batches/${id}`);
        if (!res.ok) {
          if (!cancelled) setError(res.status === 404 ? "Batch not found" : "Failed to load batch");
          return;
        }
        const data = (await res.json()) as BatchDetail;
        if (!cancelled) setBatch(data);
      } catch {
        if (!cancelled) setError("Failed to load batch");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/entities");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setEntities(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ fontSize: 14, color: "#c44520" }}>{error}</div>
        <Link href="/documents" style={{ fontSize: 13, color: "#2d5a3d", marginTop: 12, display: "inline-block" }}>
          ← Back to Documents
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ marginBottom: 20, fontSize: 12, color: "#6b6b76", display: "flex", gap: 6, alignItems: "center" }}>
        <Link href="/review" style={{ color: "#6b6b76", textDecoration: "none" }}>Review</Link>
        <span style={{ color: "#ddd9d0" }}>/</span>
        <span style={{ color: "#1a1a1f" }}>Batch</span>
      </div>

      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f", letterSpacing: "-0.02em", margin: 0 }}>
            {batch?.name || "Batch review"}
          </h1>
          <p style={{ fontSize: 13, color: "#6b6b76", margin: "4px 0 0 0" }}>
            Review documents the pipeline has finished processing.
          </p>
        </div>
        <Link
          href="/review"
          style={{
            fontSize: 13, color: "#2d5a3d", textDecoration: "none",
            padding: "6px 12px", border: "1px solid #ddd9d0", borderRadius: 6,
            flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          ← Back to Review
        </Link>
      </div>

      <ProcessingView
        batchId={id}
        entities={entities}
        onComplete={() => router.push("/entities")}
      />
    </div>
  );
}
