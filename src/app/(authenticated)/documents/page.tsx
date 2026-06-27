"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
// StatCard available for future use
// import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { DocIcon, SearchIcon, XIcon, SparkleIcon, DownIcon, ChatIcon } from "@/components/ui/icons";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";
import { ProcessingView } from "@/components/pipeline/ProcessingView";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { SuggestedSends } from "@/components/entities/SuggestedSends";
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
  const [visibleCount, setVisibleCount] = useState(30);

  // Missing expectations state
  const [missingExpectations, setMissingExpectations] = useState<Array<{
    entity_id: string;
    entity_name: string;
    missing_count: number;
    missing: Array<{
      id: string;
      document_type: string;
      document_category: string;
      is_required: boolean;
      source: string;
    }>;
  }>>([]);
  const [, setMissingLoaded] = useState(false);

  // Pipeline upload state
  const [showUpload, setShowUpload] = useState(false);
  const [pipelineBatchId, setPipelineBatchId] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<"upload" | "processing" | "results">("upload");

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
    const controller = new AbortController();
    fetchAll();
    // Fetch missing expectations for the "Missing" filter
    fetch("/api/expectations")
      .then(async (res) => {
        if (res.ok) setMissingExpectations(await res.json());
        setMissingLoaded(true);
      })
      .catch(() => setMissingLoaded(true));
    return () => controller.abort();
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

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(30);
  }, [categoryFilter, searchQuery]);

  const visibleDocs = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  /* ---- Stats ---- */

  /* ---- Download ---- */
  const handleDownload = (docId: string) => {
    window.open(`/api/documents/${docId}/download`, "_blank");
  };

  /* ---- Delete ---- */
  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    // Optimistic removal from UI
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch (err) {
      console.error("Delete error:", err);
      fetchAll(); // Revert on failure
    }
  };

  /* ---- Filter categories ---- */
  const totalMissing = missingExpectations.reduce((sum, e) => sum + e.missing_count, 0);
  const filterCategories = [
    { key: "all", label: "All" },
    ...Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([key, cat]) => ({
      key,
      label: cat.label,
    })),
    ...(totalMissing > 0 ? [{ key: "missing", label: `Missing (${totalMissing})` }] : []),
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
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent("rhodes:open-chat")); }}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
            borderRadius: 7, border: "1px solid #ddd9d0", background: "none",
            cursor: "pointer", color: "#6b6b76", fontSize: 13, fontWeight: 500,
          }}
        >
          <ChatIcon size={14} /> Upload via chat
        </button>
      </div>

      {/* Proactive "Suggested sends" — renders nothing when there's nothing to suggest */}
      <SuggestedSends onSent={() => fetchAll()} />

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
          const isMissingChip = cat.key === "missing";
          const activeColor = isMissingChip ? "#c47520" : "#2d5a3d";
          const activeBg = isMissingChip ? "rgba(196,117,32,0.08)" : "rgba(45,90,61,0.08)";
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(cat.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 16,
                border: `1px solid ${isActive ? activeColor : "#ddd9d0"}`,
                background: isActive ? activeBg : "#fff",
                color: isActive ? activeColor : isMissingChip ? "#c47520" : "#6b6b76",
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

      {/* Missing expectations view */}
      {categoryFilter === "missing" ? (
        <div>
          {missingExpectations.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 14, color: "#2d5a3d", fontWeight: 500 }}>All caught up!</div>
              <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
                Every expected document is on file across all entities.
              </div>
            </div>
          ) : (
            missingExpectations.map((entity) => (
              <div key={entity.entity_id} style={{ marginBottom: 24 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                }}>
                  <button
                    onClick={() => router.push(`/entities/${entity.entity_id}`)}
                    style={{
                      background: "none", border: "none", cursor: "pointer", padding: 0,
                      fontSize: 14, fontWeight: 600, color: "#1a1a1f",
                    }}
                  >
                    {entity.entity_name}
                  </button>
                  <span style={{
                    fontSize: 11, fontWeight: 500, color: "#c47520",
                    background: "rgba(196,117,32,0.08)", padding: "1px 8px", borderRadius: 10,
                  }}>
                    missing {entity.missing_count}
                  </span>
                </div>
                <div style={{
                  background: "#fff", border: "1px solid #e8e6df", borderRadius: 8,
                  overflow: "hidden",
                }}>
                  {entity.missing.map((exp, idx) => (
                    <div key={exp.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px",
                      borderBottom: idx < entity.missing.length - 1 ? "1px solid #f0eee8" : "none",
                      fontSize: 13,
                    }}>
                      <span style={{
                        width: 14, height: 14, borderRadius: "50%",
                        border: "1.5px solid #c47520", flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, color: "#1a1a1f" }}>
                        {DOCUMENT_TYPE_LABELS[exp.document_type] || exp.document_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                        color: "#6b6b76", background: "rgba(107,107,118,0.08)",
                      }}>
                        {DOCUMENT_CATEGORY_LABELS[exp.document_category as DocumentCategory] || exp.document_category}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                        color: exp.is_required ? "#c47520" : "#6b6b76",
                        background: exp.is_required ? "rgba(196,117,32,0.08)" : "rgba(107,107,118,0.08)",
                      }}>
                        {exp.is_required ? "Required" : "Recommended"}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                        color: exp.source === "template" ? "#3366a8" : "#6b6b76",
                        background: exp.source === "template" ? "rgba(51,102,168,0.08)" : "rgba(107,107,118,0.08)",
                      }}>
                        {exp.source === "template" ? "Template" : exp.source === "manual" ? "Manual" : "System"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (

      /* Documents table */
      filtered.length === 0 ? (
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
        <>
        {isMobile ? (
          /* ---- Mobile: Card layout ---- */
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleDocs.map((doc) => {
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
                    ) : doc.investment_id && doc.investment_name ? (
                      <Link
                        href={`/investments/${doc.investment_id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: "#7b4db5",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`Investment: ${doc.investment_name}`}
                      >
                        {doc.investment_name}
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
            {visibleDocs.map((doc) => {
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
                    }}
                    className="row-hover"
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

                    {/* Entity link, or fall back to investment if doc is
                        only investment-linked (common for investment
                        correspondence where there's no specific investor). */}
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
                    ) : doc.investment_id && doc.investment_name ? (
                      <Link
                        href={`/investments/${doc.investment_id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 12,
                          color: "#7b4db5",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`Investment: ${doc.investment_name}`}
                      >
                        {doc.investment_name}
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
        )}

        {/* Load more */}
        {hasMore && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setVisibleCount((prev) => prev + 30)}
            >
              Load more ({filtered.length - visibleCount} remaining)
            </Button>
          </div>
        )}
        {!hasMore && filtered.length > 30 && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <span style={{ fontSize: 12, color: "#9494a0" }}>
              Showing all {filtered.length} documents
            </span>
          </div>
        )}
        </>
      ))}
    </div>
  );
}
