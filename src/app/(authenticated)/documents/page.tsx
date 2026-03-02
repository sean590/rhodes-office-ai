"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { DocIcon, SearchIcon, XIcon, UploadIcon, SparkleIcon, PlusIcon, DownIcon } from "@/components/ui/icons";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";
import { ProcessingView } from "@/components/pipeline/ProcessingView";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES, DOCUMENT_CATEGORY_OPTIONS, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import type { DocumentType } from "@/lib/types/enums";
import type { Document as DocRecord, DocumentCategory } from "@/lib/types/entities";

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
  const isMobile = useIsMobile();
  const [documents, setDocuments] = useState<DocWithEntity[]>([]);
  const [entities, setEntities] = useState<EntityBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Pipeline upload state
  const [showUpload, setShowUpload] = useState(false);
  const [pipelineBatchId, setPipelineBatchId] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<"upload" | "processing" | "results">("upload");

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

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "documents_list" });
    return () => setPageContext(null);
  }, [setPageContext]);

  /** Light refresh — updates documents list without full-page loading state */
  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const allDocs: DocWithEntity[] = await res.json();
        setDocuments(allDocs);
      }
    } catch { /* ignore */ }
  }, []);

  /* ---- Filtered documents ---- */
  const filtered = useMemo(() => {
    let result = documents;
    if (categoryFilter !== "all") {
      result = result.filter((d) => {
        // Prefer document_category if available, fall back to deriving from type
        if (d.document_category) return d.document_category === categoryFilter;
        const catTypes = DOCUMENT_TYPE_CATEGORIES[categoryFilter]?.types || [];
        return catTypes.includes(d.document_type);
      });
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
    const cat = d.document_category || getDocCategory(d.document_type);
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

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

  /* ---- Expandable row state ---- */
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  /* ---- Inline rename state ---- */
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleRename = async (docId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Rename failed");
      setEditingDocId(null);
      setEditingName("");
      fetchAll();
    } catch (err) {
      console.error("Rename error:", err);
    }
  };

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
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", marginBottom: 24, gap: isMobile ? 12 : 0 }}>
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
          onClick={async () => {
            if (showUpload) {
              setShowUpload(false);
              setPipelineBatchId(null);
              setPipelinePhase("upload");
              return;
            }
            // Create a new pipeline batch
            try {
              const res = await fetch("/api/pipeline/batches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ context: "global", entity_discovery: true }),
              });
              if (res.ok) {
                const batch = await res.json();
                setPipelineBatchId(batch.id);
                setShowUpload(true);
              }
            } catch { /* ignore */ }
          }}
        >
          <PlusIcon size={14} /> {isMobile ? "Upload" : "Upload Documents"}
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

      {/* Pipeline Upload */}
      {showUpload && pipelineBatchId && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {pipelinePhase === "upload" && (
            <>
              <UploadDropZone
                batchId={pipelineBatchId}
                onFilesUploaded={async () => {
                  // Start processing before switching phase so items are queued before polling starts
                  await fetch(`/api/pipeline/batches/${pipelineBatchId}/process`, { method: "POST" });
                  setPipelinePhase("processing");
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowUpload(false);
                    setPipelineBatchId(null);
                    setPipelinePhase("upload");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}

          {(pipelinePhase === "processing" || pipelinePhase === "results") && (
            <ProcessingView
              batchId={pipelineBatchId}
              entities={entities}
              onDocumentsChanged={refreshDocuments}
              onComplete={() => {
                setShowUpload(false);
                setPipelineBatchId(null);
                setPipelinePhase("upload");
              }}
            />
          )}
        </div>
      )}

      {/* Filter pills */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 16,
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : undefined,
          WebkitOverflowScrolling: "touch",
          paddingBottom: isMobile ? 4 : 0,
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
                flexShrink: 0,
                whiteSpace: "nowrap",
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
        isMobile ? (
          /* ---- Mobile: Card layout ---- */
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((doc) => {
              const docCategory = doc.document_category || getDocCategory(doc.document_type);
              const categoryLabel = DOCUMENT_CATEGORY_LABELS[docCategory as DocumentCategory] || docCategory;
              const typeLabel = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;

              return (
                <div
                  key={doc.id}
                  onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e8e6df",
                    borderRadius: 10,
                    padding: "14px 16px",
                    cursor: "pointer",
                  }}
                >
                  {/* Row 1: Name + Type badge */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                      <DocIcon size={14} />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
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
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#3366a8",
                        background: "rgba(51,102,168,0.08)",
                        padding: "2px 8px",
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {typeLabel}
                    </span>
                  </div>

                  {/* Row 2: Entity name + upload date */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#9494a0", marginBottom: 6 }}>
                    {doc.entity_id ? (
                      <Link
                        href={`/entities/${doc.entity_id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
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
                      <span style={{ fontStyle: "italic" }}>Unassigned</span>
                    )}
                    <span style={{ color: "#ddd9d0" }}>|</span>
                    <span style={{ flexShrink: 0 }}>{formatRelativeDate(doc.created_at)}</span>
                  </div>

                  {/* Row 3: Category pill + file size */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#2d5a3d",
                        background: "rgba(45,90,61,0.08)",
                        padding: "2px 8px",
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {categoryLabel}
                    </span>
                    <span style={{ fontSize: 11, color: "#9494a0" }}>
                      {formatFileSize(doc.file_size)}
                    </span>
                  </div>

                  {/* Expanded detail on tap */}
                  {expandedDocId === doc.id && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid #e8e6df",
                      }}
                    >
                      {/* Inline rename */}
                      <div style={{ marginBottom: 10 }}>
                        {editingDocId === doc.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRename(doc.id);
                                if (e.key === "Escape") { setEditingDocId(null); setEditingName(""); }
                              }}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#1a1a1f",
                                background: "#fff",
                                border: "1px solid #ddd9d0",
                                borderRadius: 6,
                                padding: "4px 8px",
                                fontFamily: "inherit",
                                outline: "none",
                              }}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRename(doc.id); }}
                              style={{ background: "#2d5a3d", color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                            >
                              Save
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingDocId(null); setEditingName(""); }}
                              style={{ background: "none", border: "1px solid #ddd9d0", borderRadius: 5, padding: "4px 10px", fontSize: 12, color: "#6b6b76", cursor: "pointer", fontFamily: "inherit" }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>{doc.name}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingDocId(doc.id); setEditingName(doc.name); }}
                              title="Rename"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex", alignItems: "center" }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* All tags */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#2d5a3d", background: "rgba(45,90,61,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                          {categoryLabel}
                        </span>
                        {doc.document_type !== "other" && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                            {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                          </span>
                        )}
                        {doc.year && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "3px 10px", borderRadius: 4 }}>
                            {doc.year}
                          </span>
                        )}
                      </div>

                      {/* AI Summary */}
                      {(doc.ai_extraction as { summary?: string } | null)?.summary && (
                        <div
                          style={{
                            background: "#fafaf7",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "10px 14px",
                            fontSize: 12,
                            color: "#4a4a52",
                            lineHeight: 1.5,
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                            AI Summary
                          </div>
                          {(doc.ai_extraction as { summary?: string })?.summary}
                        </div>
                      )}

                      {/* Details */}
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
                        <span>Size: {formatFileSize(doc.file_size)}</span>
                        <span>Uploaded: {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleProcess(doc.id); }}
                          disabled={processingId === doc.id}
                          style={{
                            background: "none",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: processingId === doc.id ? "wait" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            color: "#c47520",
                            fontWeight: 500,
                            fontFamily: "inherit",
                          }}
                        >
                          <SparkleIcon size={12} />
                          {processingId === doc.id ? "Processing..." : doc.ai_extracted ? "Re-process" : "AI Process"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(doc.id); }}
                          style={{
                            background: "none",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#3366a8",
                            fontWeight: 500,
                            fontFamily: "inherit",
                          }}
                        >
                          Download
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                          style={{
                            background: "none",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#c73e3e",
                            fontWeight: 500,
                            fontFamily: "inherit",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ---- Desktop: Table layout ---- */
          <Card style={{ padding: 0 }}>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 120px 80px 70px 40px",
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
              <div>Tags</div>
              <div>Uploaded</div>
              <div style={{ textAlign: "right" }}>Size</div>
              <div />
            </div>

            {/* Table rows */}
            {filtered.map((doc) => {
              const isExpanded = expandedDocId === doc.id;
              const docCategory = doc.document_category || getDocCategory(doc.document_type);
              const categoryLabel = DOCUMENT_CATEGORY_LABELS[docCategory as DocumentCategory] || docCategory;
              const extraction = doc.ai_extraction as { summary?: string; actions?: unknown[] } | null;

              return (
                <div key={doc.id}>
                  {/* Compact row */}
                  <div
                    onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px 120px 80px 70px 40px",
                      gap: 8,
                      padding: "10px 18px",
                      borderBottom: isExpanded ? "none" : "1px solid #f8f7f4",
                      fontSize: 13,
                      alignItems: "center",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fafaf7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
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
                        onClick={(e) => e.stopPropagation()}
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

                    {/* Tags — category pill */}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#2d5a3d",
                        background: "rgba(45,90,61,0.08)",
                        padding: "2px 8px",
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                        display: "inline-block",
                        width: "fit-content",
                      }}
                    >
                      {categoryLabel}
                    </span>

                    {/* Uploaded */}
                    <span style={{ fontSize: 11, color: "#9494a0" }}>
                      {formatRelativeDate(doc.created_at)}
                    </span>

                    {/* Size */}
                    <span style={{ fontSize: 11, color: "#9494a0", textAlign: "right" }}>
                      {formatFileSize(doc.file_size)}
                    </span>

                    {/* Expand indicator */}
                    <div style={{ textAlign: "center", color: "#9494a0", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                      <DownIcon size={12} />
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: "12px 18px 16px",
                        borderBottom: "1px solid #e8e6df",
                        background: "#fafaf7",
                      }}
                    >
                      {/* Full document name — inline rename */}
                      <div style={{ marginBottom: 10 }}>
                        {editingDocId === doc.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRename(doc.id);
                                if (e.key === "Escape") { setEditingDocId(null); setEditingName(""); }
                              }}
                              style={{
                                flex: 1,
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#1a1a1f",
                                background: "#fff",
                                border: "1px solid #ddd9d0",
                                borderRadius: 6,
                                padding: "4px 8px",
                                fontFamily: "inherit",
                                outline: "none",
                              }}
                            />
                            <button
                              onClick={() => handleRename(doc.id)}
                              style={{ background: "#2d5a3d", color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingDocId(null); setEditingName(""); }}
                              style={{ background: "none", border: "1px solid #ddd9d0", borderRadius: 5, padding: "4px 10px", fontSize: 12, color: "#6b6b76", cursor: "pointer", fontFamily: "inherit" }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>{doc.name}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingDocId(doc.id); setEditingName(doc.name); }}
                              title="Rename"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex", alignItems: "center" }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* All tags */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#2d5a3d", background: "rgba(45,90,61,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                          {categoryLabel}
                        </span>
                        {doc.document_type !== "other" && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                            {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                          </span>
                        )}
                        {doc.year && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "3px 10px", borderRadius: 4 }}>
                            {doc.year}
                          </span>
                        )}
                      </div>

                      {/* AI Summary */}
                      {extraction?.summary && (
                        <div
                          style={{
                            background: "#fff",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "10px 14px",
                            fontSize: 12,
                            color: "#4a4a52",
                            lineHeight: 1.5,
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                            AI Summary
                          </div>
                          {extraction.summary}
                        </div>
                      )}

                      {/* Details row */}
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
                        <span>Size: {formatFileSize(doc.file_size)}</span>
                        <span>Uploaded: {new Date(doc.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
                        {doc.mime_type && <span>Type: {doc.mime_type}</span>}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleProcess(doc.id)}
                          disabled={processingId === doc.id}
                          style={{
                            background: "none",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: processingId === doc.id ? "wait" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            color: "#c47520",
                            fontWeight: 500,
                            fontFamily: "inherit",
                          }}
                        >
                          <SparkleIcon size={12} />
                          {processingId === doc.id ? "Processing..." : doc.ai_extracted ? "Re-process with AI" : "Process with AI"}
                        </button>
                        <button
                          onClick={() => handleDownload(doc.id)}
                          style={{
                            background: "none",
                            border: "1px solid #e8e6df",
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: "pointer",
                            fontSize: 12,
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
                            borderRadius: 6,
                            padding: "5px 12px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#c73e3e",
                            fontWeight: 500,
                            fontFamily: "inherit",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )
      )}
    </div>
  );
}
