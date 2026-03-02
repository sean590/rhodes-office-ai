"use client";

import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";

interface UploadDropZoneProps {
  batchId: string;
  defaultEntityId?: string | null;
  onFilesUploaded: (items: UploadedItem[]) => void;
}

export interface UploadedItem {
  id: string;
  original_filename: string;
  staged_doc_type: string | null;
  staged_entity_id: string | null;
  staged_entity_name: string | null;
  staged_year: number | null;
  staged_category: string | null;
  staging_confidence: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDropZone({ batchId, defaultEntityId, onFilesUploaded }: UploadDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Array<{ filename: string; reason: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setError(null);
    setDuplicates([]);
    setUploadProgress(`Uploading ${fileArray.length} file${fileArray.length !== 1 ? "s" : ""}...`);

    try {
      const formData = new FormData();
      for (const file of fileArray) {
        formData.append("files", file);
      }

      const res = await fetch(`/api/pipeline/batches/${batchId}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const result = await res.json();

      if (result.duplicates?.length > 0) {
        setDuplicates(result.duplicates);
      }

      if (result.items?.length > 0) {
        onFilesUploaded(result.items);
      }

      setUploadProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadProgress(null);
    } finally {
      setUploading(false);
    }
  }, [batchId, onFilesUploaded]);

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {/* Drop zone */}
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
          }
        }}
        style={{
          border: `2px dashed ${dragOver ? "#2d5a3d" : "#ddd9d0"}`,
          borderRadius: 10,
          margin: 16,
          padding: uploading ? "16px" : "32px 16px",
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          background: dragOver ? "rgba(45,90,61,0.04)" : "#fafaf7",
          transition: "all 0.15s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />

        {uploading ? (
          <div>
            <div style={{ fontSize: 13, color: "#2d5a3d", fontWeight: 500 }}>
              {uploadProgress}
            </div>
            <div style={{
              marginTop: 8,
              height: 4,
              background: "#e8e6df",
              borderRadius: 2,
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                background: "#2d5a3d",
                borderRadius: 2,
                width: "60%",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
            </div>
          </div>
        ) : (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9494a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div style={{ fontSize: 13, color: "#6b6b76", marginTop: 8 }}>
              Drop files here or click to browse
            </div>
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
              PDF, images, or text documents — no file limit
            </div>
          </>
        )}
      </div>

      {/* Duplicate warnings */}
      {duplicates.length > 0 && (
        <div style={{ padding: "0 16px 12px" }}>
          {duplicates.map((dup, i) => (
            <div key={i} style={{
              padding: "6px 10px",
              background: "rgba(234,179,8,0.08)",
              border: "1px solid rgba(234,179,8,0.2)",
              borderRadius: 6,
              fontSize: 12,
              color: "#92400e",
              marginTop: i > 0 ? 4 : 0,
            }}>
              <strong>{dup.filename}</strong>: {dup.reason}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          margin: "0 16px 12px",
          padding: "8px 12px",
          background: "rgba(220,38,38,0.06)",
          border: "1px solid rgba(220,38,38,0.15)",
          borderRadius: 6,
          fontSize: 12,
          color: "#dc2626",
        }}>
          {error}
        </div>
      )}
    </Card>
  );
}
