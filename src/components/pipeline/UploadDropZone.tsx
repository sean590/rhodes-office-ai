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

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function UploadDropZone({ batchId, defaultEntityId: _defaultEntityId, onFilesUploaded }: UploadDropZoneProps) {
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
    setUploadProgress("Preparing upload...");

    try {
      // Phase 1: Get signed upload URLs from the server
      const presignRes = await fetch(`/api/pipeline/batches/${batchId}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: fileArray.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });

      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to prepare upload (${presignRes.status})`);
      }

      const presignData = await presignRes.json();
      const rejectedFiles: Array<{ filename: string; reason: string }> = presignData.rejected || [];

      if (presignData.urls.length === 0) {
        if (rejectedFiles.length > 0) {
          setDuplicates(rejectedFiles);
          setUploadProgress(null);
          setUploading(false);
          return;
        }
        throw new Error("No files could be prepared for upload");
      }

      // Build a map from originalName to File for lookup
      const fileMap = new Map<string, File>();
      for (const f of fileArray) {
        fileMap.set(f.name, f);
      }

      // Phase 2: Upload files directly to Supabase Storage + compute hashes
      const uploadedFiles: Array<{
        originalName: string;
        storagePath: string;
        size: number;
        type: string;
        contentHash: string;
      }> = [];

      for (let i = 0; i < presignData.urls.length; i++) {
        const urlInfo = presignData.urls[i];
        const file = fileMap.get(urlInfo.originalName);
        if (!file) continue;

        setUploadProgress(`Uploading ${i + 1} of ${presignData.urls.length}...`);

        // Upload directly to Supabase Storage using the signed URL
        const uploadRes = await fetch(urlInfo.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!uploadRes.ok) {
          rejectedFiles.push({ filename: file.name, reason: `Upload failed (${uploadRes.status})` });
          continue;
        }

        // Compute hash client-side
        const contentHash = await computeHash(file);

        uploadedFiles.push({
          originalName: file.name,
          storagePath: urlInfo.storagePath,
          size: file.size,
          type: file.type,
          contentHash,
        });
      }

      if (uploadedFiles.length === 0) {
        if (rejectedFiles.length > 0) {
          setDuplicates(rejectedFiles);
          setUploadProgress(null);
          setUploading(false);
          return;
        }
        throw new Error("All files failed to upload");
      }

      // Phase 3: Register uploaded files with the server
      setUploadProgress("Processing...");
      const registerRes = await fetch(`/api/pipeline/batches/${batchId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploadedFiles }),
      });

      if (!registerRes.ok) {
        const data = await registerRes.json().catch(() => ({}));
        throw new Error(data.error || `Registration failed (${registerRes.status})`);
      }

      const result = await registerRes.json();

      const allDuplicates = [...rejectedFiles, ...(result.duplicates || [])];
      if (allDuplicates.length > 0) {
        setDuplicates(allDuplicates);
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
              PDF, images, or text documents — no size limit
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
