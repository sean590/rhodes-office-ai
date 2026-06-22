"use client";

/**
 * BulkUploadCard — a non-chat place to dump documents. Creates a pipeline
 * batch and runs the files through the SAME backend path as chat upload
 * (presign → upload → register → process → document agent). Because the batch
 * carries created_by, the worker seeds a review session for any deferred doc,
 * so bulk-uploaded docs are reviewable/refinable exactly like chat uploads.
 */

import { useState, useCallback } from "react";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";
import { Icon } from "@/components/ui/icon";

export function BulkUploadCard({ onUploaded }: { onUploaded?: () => void }) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const start = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/pipeline/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global", entity_discovery: true }),
      });
      if (!res.ok) { alert("Couldn't start the upload."); return; }
      const batch = await res.json();
      setBatchId(batch.id);
    } catch {
      alert("Couldn't start the upload.");
    } finally {
      setCreating(false);
    }
  }, []);

  if (!batchId) {
    return (
      <button
        onClick={start}
        disabled={creating}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px", borderRadius: "var(--radius)",
          border: "1px dashed var(--line-2)", background: "var(--card)",
          cursor: creating ? "default" : "pointer", textAlign: "left",
          fontFamily: "inherit", color: "var(--ink)",
        }}
      >
        <Icon name="upload" size={18} stroke={1.75} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {creating ? "Starting…" : "Upload documents"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
            Drop a batch of files — they go through the same pipeline as chat.
          </div>
        </div>
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <UploadDropZone
        batchId={batchId}
        onFilesUploaded={async () => {
          await fetch(`/api/pipeline/batches/${batchId}/process`, { method: "POST" });
          setBatchId(null);
          onUploaded?.();
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => setBatchId(null)}
          style={{
            fontSize: 12.5, fontWeight: 600, padding: "5px 12px",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--line)",
            background: "var(--card)", color: "var(--muted)", cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
