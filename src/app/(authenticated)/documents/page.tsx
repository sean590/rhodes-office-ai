"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { DocIcon, SearchIcon, XIcon, UploadIcon, SparkleIcon, PlusIcon } from "@/components/ui/icons";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES } from "@/lib/constants";
import type { DocumentType } from "@/lib/types/enums";
import type { Document as DocRecord } from "@/lib/types/entities";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EntityBasic {
  id: string;
  name: string;
  type: string;
}

interface DocWithEntity extends DocRecord {
  entity_name: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function getDocCategory(docType: DocumentType): string {
  for (const [key, cat] of Object.entries(DOCUMENT_TYPE_CATEGORIES)) {
    if (cat.types.includes(docType)) return key;
  }
  return "other";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocWithEntity[]>([]);
  const [entities, setEntities] = useState<EntityBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState<DocumentType | "">("");
  const [uploadYear, setUploadYear] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadEntityId, setUploadEntityId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI processing state
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<{
    docId: string;
    count: number;
    entityId: string | null;
    actions: Array<{ action: string; data: Record<string, unknown>; reason?: string; confidence?: string }>;
  } | null>(null);
  const [applyingEntity, setApplyingEntity] = useState(false);

  /* ---- Fetch all documents + entities list ---- */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, entitiesRes] = await Promise.all([
        fetch("/api/documents"),
        fetch("/api/entities"),
      ]);

      if (entitiesRes.ok) {
        const entList: EntityBasic[] = await entitiesRes.json();
        setEntities(entList);
      }

      if (!docsRes.ok) throw new Error("Failed to fetch documents");
      const allDocs: DocWithEntity[] = await docsRes.json();
      setDocuments(allDocs);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ---- Filtered documents ---- */
  const filtered = useMemo(() => {
    let result = documents;
    if (categoryFilter !== "all") {
      const catTypes = DOCUMENT_TYPE_CATEGORIES[categoryFilter]?.types || [];
      result = result.filter((d) => catTypes.includes(d.document_type));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.entity_name || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [documents, categoryFilter, searchQuery]);

  /* ---- Stats ---- */
  const aiProcessed = documents.filter((d) => d.ai_extracted).length;
  const categoryCounts: Record<string, number> = {};
  documents.forEach((d) => {
    const cat = getDocCategory(d.document_type);
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  /* ---- Upload ---- */
  const handleFileSelect = (file: File) => {
    setUploadFile(file);
    if (!uploadName) {
      setUploadName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadType) return;

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("document_type", uploadType);
      formData.append("name", uploadName || uploadFile.name);
      if (uploadYear) formData.append("year", uploadYear);
      if (uploadNotes) formData.append("notes", uploadNotes);
      if (uploadEntityId) formData.append("entity_id", uploadEntityId);

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const doc = await res.json();

      // Reset form
      setUploadFile(null);
      setUploadName("");
      setUploadType("");
      setUploadYear("");
      setUploadNotes("");
      setUploadEntityId("");
      setUploadError(null);
      setShowUpload(false);

      // Trigger AI processing automatically
      setProcessingId(doc.id);
      try {
        const processRes = await fetch(`/api/documents/${doc.id}/process`, {
          method: "POST",
        });
        if (processRes.ok) {
          const result = await processRes.json();
          const actions = result.actions || [];
          setProcessResult({
            docId: doc.id,
            count: actions.length,
            entityId: doc.entity_id || null,
            actions,
          });
        }
      } catch {
        // AI processing failure is non-fatal
      } finally {
        setProcessingId(null);
      }

      fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  /* ---- AI Process ---- */
  const handleProcess = async (docId: string) => {
    setProcessingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/process`, { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        const actions = result.actions || [];
        // Use entity_id from AI response (auto-associated), falling back to doc's existing entity
        const doc = documents.find((d) => d.id === docId);
        const entityId = result.entity_id || doc?.entity_id || null;
        setProcessResult({
          docId,
          count: actions.length,
          entityId,
          actions,
        });
      }
      fetchAll();
    } catch (err) {
      console.error("Process error:", err);
    } finally {
      setProcessingId(null);
    }
  };

  /* ---- Create entity only + redirect to review remaining changes ---- */
  const handleCreateAndRedirect = async () => {
    if (!processResult) return;
    setApplyingEntity(true);
    try {
      const createActionIndex = processResult.actions.findIndex((a) => a.action === "create_entity");
      const createAction = createActionIndex >= 0 ? processResult.actions[createActionIndex] : null;

      if (createAction) {
        // Only apply the create_entity action — everything else stays for review
        const res = await fetch(`/api/documents/${processResult.docId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: [createAction], action_indices: [createActionIndex] }),
        });

        if (!res.ok) throw new Error("Failed to create entity");
        const result = await res.json();

        const createdEntity = result.results?.find(
          (r: { action: string; success: boolean; data?: { id?: string } }) =>
            r.action === "create_entity" && r.success && r.data?.id
        );

        if (createdEntity?.data?.id) {
          router.push(`/entities/${createdEntity.data.id}?tab=documents`);
          return;
        }
      }

      // AI identified an existing entity (auto-associated by process endpoint)
      if (processResult.entityId) {
        router.push(`/entities/${processResult.entityId}?tab=documents`);
        return;
      }

      // No create_entity action and no identified entity — try update_entity actions
      const updateAction = processResult.actions.find((a) => a.action === "update_entity");
      const entityId = updateAction?.data?.entity_id as string | undefined;
      if (entityId) {
        router.push(`/entities/${entityId}?tab=documents`);
        return;
      }

      // Fallback
      setProcessResult(null);
      fetchAll();
    } catch (err) {
      console.error("Create error:", err);
    } finally {
      setApplyingEntity(false);
    }
  };

  /* ---- Download ---- */
  const handleDownload = async (docId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/download`);
      if (!res.ok) throw new Error("Download failed");
      const data = await res.json();
      window.open(data.url, "_blank");
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  /* ---- Delete ---- */
  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      fetchAll();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  /* ---- Filter categories ---- */
  const filterCategories = [
    { key: "all", label: "All" },
    ...Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([key, cat]) => ({
      key,
      label: cat.label,
    })),
  ];

  /* ---- Document type options ---- */
  const docTypeOptions = Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([, cat]) => ({
    label: cat.label,
    types: cat.types.map((t: string) => ({
      value: t,
      label: DOCUMENT_TYPE_LABELS[t as DocumentType] || t,
    })),
  }));

  const inputStyle: React.CSSProperties = {
    background: "#fafaf7",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#6b6b76",
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  };

  /* ---- Render ---- */
  if (loading) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f" }}>Documents</div>
        <div style={{ color: "#9494a0", marginTop: 12 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: 0 }}>
            Documents
          </h1>
          <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0" }}>
            All documents across entities
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowUpload(!showUpload)}
        >
          <PlusIcon size={14} /> Upload Document
        </Button>
      </div>

      {/* AI Processing Banner */}
      {processingId && (
        <div
          style={{
            background: "rgba(45,90,61,0.06)",
            border: "1px solid rgba(45,90,61,0.2)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "#2d5a3d",
          }}
        >
          <SparkleIcon size={16} />
          <span>Processing document with AI...</span>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              border: "2px solid rgba(45,90,61,0.3)",
              borderTopColor: "#2d5a3d",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* AI Result Banner */}
      {processResult && (() => {
        const createEntityAction = processResult.actions.find((a) => a.action === "create_entity");
        const hasEntity = !!processResult.entityId;
        const proposedEntityName = (createEntityAction?.data?.name as string) || "New Entity";
        const otherCount = processResult.count - (createEntityAction ? 1 : 0);

        // If document is associated with an entity (either already had one, or AI identified one)
        if (hasEntity) {
          return (
            <div
              style={{
                background: "rgba(45,90,61,0.06)",
                border: "1px solid rgba(45,90,61,0.2)",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#2d5a3d" }}>
                <SparkleIcon size={16} />
                <span>
                  {processResult.count > 0
                    ? <>AI found <strong>{processResult.count}</strong> proposed change{processResult.count !== 1 ? "s" : ""}. Document linked to entity.</>
                    : <>Analysis complete. Document linked to entity — no changes needed.</>
                  }
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Link
                  href={`/entities/${processResult.entityId}?tab=documents`}
                  style={{
                    padding: "5px 12px",
                    background: "#2d5a3d",
                    color: "#fff",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {processResult.count > 0 ? "Review on Entity Page" : "View Entity"}
                </Link>
                <button
                  onClick={() => setProcessResult(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6b76", padding: 2 }}
                >
                  <XIcon size={12} />
                </button>
              </div>
            </div>
          );
        }

        // Unassociated document — show proposed entity + apply button
        return (
          <Card style={{ marginBottom: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <SparkleIcon size={18} />
              <span style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f" }}>
                AI Analysis Complete
              </span>
              <span style={{ fontSize: 12, color: "#6b6b76" }}>
                {processResult.count} proposed change{processResult.count !== 1 ? "s" : ""}
              </span>
            </div>

            {createEntityAction && (
              <div
                style={{
                  background: "#fafaf7",
                  border: "1px solid #ddd9d0",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Create New Entity
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", marginBottom: 4 }}>
                  {proposedEntityName}
                </div>
                <div style={{ fontSize: 12, color: "#6b6b76", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {createEntityAction.data?.type ? (
                    <span>Type: <strong>{String(createEntityAction.data.type).replace(/_/g, " ")}</strong></span>
                  ) : null}
                  {createEntityAction.data?.formation_state ? (
                    <span>State: <strong>{String(createEntityAction.data.formation_state)}</strong></span>
                  ) : null}
                  {createEntityAction.data?.ein ? (
                    <span>EIN: <strong>{String(createEntityAction.data.ein)}</strong></span>
                  ) : null}
                </div>
                {createEntityAction.reason && (
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 6, fontStyle: "italic" }}>
                    {createEntityAction.reason}
                  </div>
                )}
              </div>
            )}

            {otherCount > 0 && (
              <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
                Plus <strong>{otherCount}</strong> other change{otherCount !== 1 ? "s" : ""} (members, managers, registrations, etc.) to review on the entity page.
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleCreateAndRedirect}
                disabled={applyingEntity}
                style={{
                  padding: "8px 16px",
                  background: "#2d5a3d",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: applyingEntity ? "wait" : "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {applyingEntity ? (
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        border: "2px solid rgba(255,255,255,0.3)",
                        borderTopColor: "#fff",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    Creating...
                  </>
                ) : (
                  <>Create Entity & Review Changes</>
                )}
              </button>
              <button
                onClick={() => setProcessResult(null)}
                style={{
                  padding: "8px 16px",
                  background: "none",
                  border: "1px solid #ddd9d0",
                  borderRadius: 6,
                  fontSize: 13,
                  color: "#6b6b76",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Dismiss
              </button>
            </div>
          </Card>
        );
      })()}

      {/* Upload Form */}
      {showUpload && (
        <Card style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <UploadIcon size={16} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
              Upload Document
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            {/* Document type */}
            <div>
              <label style={labelStyle}>Document Type *</label>
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value as DocumentType)}
                style={inputStyle}
              >
                <option value="">Select type...</option>
                {docTypeOptions.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.types.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Entity selector — optional */}
            <div>
              <label style={labelStyle}>Entity (optional)</label>
              <select
                value={uploadEntityId}
                onChange={(e) => setUploadEntityId(e.target.value)}
                style={inputStyle}
              >
                <option value="">None — AI will determine</option>
                {entities
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, marginBottom: 12 }}>
            {/* Document name */}
            <div>
              <label style={labelStyle}>Document Name</label>
              <input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="Auto-filled from file name"
                style={inputStyle}
              />
            </div>

            {/* Year */}
            <div>
              <label style={labelStyle}>Year</label>
              <input
                value={uploadYear}
                onChange={(e) => setUploadYear(e.target.value)}
                placeholder="2024"
                type="number"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Notes</label>
            <input
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              placeholder="Optional notes..."
              style={inputStyle}
            />
          </div>

          {/* File drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileSelect(file);
            }}
            style={{
              border: `2px dashed ${dragOver ? "#2d5a3d" : "#ddd9d0"}`,
              borderRadius: 8,
              padding: uploadFile ? "12px 16px" : "24px 16px",
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 12,
              background: dragOver ? "rgba(45,90,61,0.04)" : "#fafaf7",
              transition: "all 0.15s",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />
            {uploadFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <DocIcon size={14} />
                <span style={{ fontSize: 13, color: "#1a1a1f" }}>{uploadFile.name}</span>
                <span style={{ fontSize: 11, color: "#9494a0" }}>
                  ({formatFileSize(uploadFile.size)})
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#c73e3e",
                    padding: 2,
                  }}
                >
                  <XIcon size={12} />
                </button>
              </div>
            ) : (
              <>
                <UploadIcon size={20} />
                <div style={{ fontSize: 13, color: "#6b6b76", marginTop: 6 }}>
                  Drop a file here or click to browse
                </div>
                <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
                  PDF, images, or text documents
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              variant="secondary"
              onClick={() => {
                setShowUpload(false);
                setUploadFile(null);
                setUploadName("");
                setUploadType("");
                setUploadYear("");
                setUploadNotes("");
                setUploadEntityId("");
                setUploadError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={uploading || !uploadFile || !uploadType}
            >
              {uploading ? "Uploading..." : "Upload & Process with AI"}
            </Button>
          </div>

          {uploadError && (
            <div style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.15)",
              borderRadius: 6,
              fontSize: 12,
              color: "#dc2626",
            }}>
              {uploadError}
            </div>
          )}
        </Card>
      )}

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatCard label="Total Documents" value={documents.length} />
        <StatCard
          label="AI Processed"
          value={aiProcessed}
          sub={documents.length > 0 ? `${Math.round((aiProcessed / documents.length) * 100)}% of total` : undefined}
          color="#2d5a3d"
        />
        <StatCard
          label="Top Categories"
          value={topCategories.length > 0 ? topCategories.map(([k]) => DOCUMENT_TYPE_CATEGORIES[k]?.label || k).join(", ") : "\u2014"}
          sub={topCategories.map(([, count]) => count).join(" / ") + " docs"}
        />
      </div>

      {/* Filter pills */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {filterCategories.map((cat) => {
          const isActive = categoryFilter === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(cat.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 16,
                border: `1px solid ${isActive ? "#2d5a3d" : "#ddd9d0"}`,
                background: isActive ? "rgba(45,90,61,0.08)" : "#fff",
                color: isActive ? "#2d5a3d" : "#6b6b76",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9494a0" }}>
          <SearchIcon size={14} />
        </div>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents by name or entity..."
          style={{
            width: "100%",
            padding: "8px 12px 8px 32px",
            border: "1px solid #ddd9d0",
            borderRadius: 8,
            fontSize: 13,
            color: "#1a1a1f",
            background: "#fff",
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9494a0",
              padding: 2,
            }}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>

      {/* Documents table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <DocIcon size={32} />
          <div style={{ fontSize: 14, color: "#6b6b76", marginTop: 12, fontWeight: 500 }}>
            {documents.length === 0 ? "No documents yet" : "No documents found"}
          </div>
          {documents.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
              Upload your first document to get started
            </div>
          ) : (searchQuery || categoryFilter !== "all") && (
            <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
              Try adjusting your search or filter
            </div>
          )}
        </div>
      ) : (
        <Card style={{ padding: 0 }}>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 130px 60px 80px 70px 160px",
              gap: 8,
              padding: "10px 18px",
              borderBottom: "1px solid #e8e6df",
              fontSize: 11,
              fontWeight: 600,
              color: "#6b6b76",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <div>Document</div>
            <div>Entity</div>
            <div>Type</div>
            <div>Year</div>
            <div>Uploaded</div>
            <div style={{ textAlign: "right" }}>Size</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>

          {/* Table rows */}
          {filtered.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 130px 60px 80px 70px 160px",
                gap: 8,
                padding: "10px 18px",
                borderBottom: "1px solid #f8f7f4",
                fontSize: 13,
                alignItems: "center",
              }}
            >
              {/* Document name + AI indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <DocIcon size={14} />
                <span
                  style={{
                    fontWeight: 500,
                    color: "#1a1a1f",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {doc.name}
                </span>
                {doc.ai_extracted && (
                  <span title="AI Processed" style={{ color: "#2d5a3d", flexShrink: 0 }}>
                    <SparkleIcon size={12} />
                  </span>
                )}
              </div>

              {/* Entity link */}
              {doc.entity_id ? (
                <Link
                  href={`/entities/${doc.entity_id}`}
                  style={{
                    fontSize: 12,
                    color: "#3366a8",
                    textDecoration: "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {doc.entity_name}
                </Link>
              ) : (
                <span style={{ fontSize: 12, color: "#9494a0", fontStyle: "italic" }}>
                  Unassigned
                </span>
              )}

              {/* Type badge */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#2d5a3d",
                  background: "rgba(45,90,61,0.08)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "inline-block",
                  maxWidth: "100%",
                }}
              >
                {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
              </span>

              {/* Year */}
              <span style={{ fontSize: 12, color: "#6b6b76" }}>
                {doc.year || "\u2014"}
              </span>

              {/* Uploaded */}
              <span style={{ fontSize: 11, color: "#9494a0" }}>
                {formatRelativeDate(doc.created_at)}
              </span>

              {/* Size */}
              <span style={{ fontSize: 11, color: "#9494a0", textAlign: "right" }}>
                {formatFileSize(doc.file_size)}
              </span>

              {/* Actions */}
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button
                  onClick={() => handleProcess(doc.id)}
                  disabled={processingId === doc.id}
                  title="Process with AI"
                  style={{
                    background: "none",
                    border: "1px solid #e8e6df",
                    borderRadius: 5,
                    padding: "3px 6px",
                    cursor: processingId === doc.id ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 11,
                    color: "#c47520",
                    fontWeight: 500,
                    fontFamily: "inherit",
                  }}
                >
                  <SparkleIcon size={11} />
                  {processingId === doc.id ? "..." : "AI"}
                </button>
                <button
                  onClick={() => handleDownload(doc.id)}
                  style={{
                    background: "none",
                    border: "1px solid #e8e6df",
                    borderRadius: 5,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: 11,
                    color: "#3366a8",
                    fontWeight: 500,
                    fontFamily: "inherit",
                  }}
                >
                  Download
                </button>
                <button
                  onClick={() => handleDelete(doc.id)}
                  style={{
                    background: "none",
                    border: "1px solid #e8e6df",
                    borderRadius: 5,
                    padding: "3px 6px",
                    cursor: "pointer",
                    fontSize: 11,
                    color: "#c73e3e",
                    fontWeight: 500,
                    fontFamily: "inherit",
                  }}
                >
                  <XIcon size={11} />
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
