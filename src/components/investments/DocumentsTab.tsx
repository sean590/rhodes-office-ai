"use client";

import { useEffect, useState, useCallback } from "react";

interface Document {
  id: string;
  name: string;
  document_type: string | null;
  document_category: string | null;
  year: number | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  ai_extraction?: { summary?: string } | null;
}

interface Props {
  investmentId: string;
  isMobile: boolean;
}

const CATEGORY_ORDER = ["formation", "contracts", "tax", "financial", "compliance", "governance", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  formation: "Formation",
  contracts: "Contracts",
  tax: "Tax",
  financial: "Financial",
  compliance: "Compliance",
  governance: "Governance",
  other: "Other",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  operating_agreement: "Operating Agreement",
  subscription_agreement: "Subscription Agreement",
  partnership_agreement: "Partnership Agreement",
  safe: "SAFE",
  articles_of_organization: "Articles of Org",
  certificate_of_formation: "Certificate of Formation",
  k1: "K-1",
  tax_return_1065: "1065 Return",
  tax_return_1120: "1120 Return",
  annual_report: "Annual Report",
  distribution_notice: "Distribution Notice",
  capital_call: "Capital Call",
  cap_table: "Cap Table",
  financial_statement: "Financial Statement",
  amendment: "Amendment",
  resolution: "Resolution",
  consent: "Consent",
  other: "Other",
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
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

function DocIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9494a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#6b6b76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function DownIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function DocumentsTab({ investmentId, isMobile }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/investments/${investmentId}/documents`);
      if (res.ok) setDocuments(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [investmentId]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const handleDownload = (docId: string) => {
    window.open(`/api/documents/${docId}/download`, "_blank");
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (res.ok) fetchDocuments();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div style={{ color: "#9494a0", fontSize: 13, padding: "20px 0" }}>Loading documents...</div>;
  }

  if (documents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", marginBottom: 4 }}>No documents yet</div>
        <div style={{ fontSize: 13, color: "#9494a0" }}>Documents linked to this investment will appear here.</div>
      </div>
    );
  }

  // Group by category
  const grouped = new Map<string, Document[]>();
  for (const doc of documents) {
    const cat = doc.document_category || "other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(doc);
  }

  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 16px", color: "#1a1a1f" }}>
        Documents ({documents.length})
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sortedCategories.map((cat) => {
          const docs = grouped.get(cat) || [];
          const collapsed = collapsedCats.has(cat);

          return (
            <div key={cat} style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 10, overflow: "hidden" }}>
              {/* Category header */}
              <div
                onClick={() => toggleCategory(cat)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 18px", cursor: "pointer",
                  borderBottom: collapsed ? "none" : "1px solid #f0eee8",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FolderIcon />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
                    {CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </span>
                  <span style={{ fontSize: 11, color: "#9494a0" }}>{docs.length}</span>
                </div>
                <div style={{ color: "#9494a0", transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                  <DownIcon />
                </div>
              </div>

              {/* Document rows */}
              {!collapsed && docs.map((doc) => {
                const isExpanded = expandedDocId === doc.id;
                const extraction = doc.ai_extraction as { summary?: string } | null;

                return (
                  <div key={doc.id}>
                    {/* Compact row */}
                    <div
                      onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                      style={{
                        display: isExpanded ? "none" : "flex",
                        alignItems: "center", gap: 12,
                        padding: "10px 18px",
                        borderBottom: "1px solid #f8f7f4",
                        fontSize: 13, cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fafaf7")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <DocIcon />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: "#1a1a1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {doc.name}
                        </div>
                      </div>

                      {doc.document_type && doc.document_type !== "other" && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" }}>
                          {DOC_TYPE_LABELS[doc.document_type] || doc.document_type.replace(/_/g, " ")}
                        </span>
                      )}

                      {doc.year && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" }}>
                          {doc.year}
                        </span>
                      )}

                      <span style={{ fontSize: 11, color: "#9494a0", whiteSpace: "nowrap" }}>
                        {formatRelativeDate(doc.created_at)}
                      </span>

                      <span style={{ fontSize: 11, color: "#9494a0", minWidth: 50, textAlign: "right" }}>
                        {formatFileSize(doc.file_size)}
                      </span>

                      <div style={{ color: "#9494a0", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                        <DownIcon />
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: "12px 18px 16px", borderBottom: "1px solid #e8e6df", background: "#fafaf7", position: "relative" }}>
                        <button
                          onClick={() => setExpandedDocId(null)}
                          style={{ position: "absolute", top: 12, right: 18, background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 4, display: "flex", alignItems: "center" }}
                          title="Collapse"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                        </button>

                        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", marginBottom: 10 }}>
                          {doc.name}
                        </div>

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                          {doc.document_type && doc.document_type !== "other" && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                              {DOC_TYPE_LABELS[doc.document_type] || doc.document_type.replace(/_/g, " ")}
                            </span>
                          )}
                          {doc.year && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "3px 10px", borderRadius: 4 }}>
                              {doc.year}
                            </span>
                          )}
                        </div>

                        {extraction?.summary && (
                          <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#4a4a52", lineHeight: 1.5, marginBottom: 12 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>AI Summary</div>
                            {extraction.summary}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
                          <span>Size: {formatFileSize(doc.file_size)}</span>
                          <span>Uploaded: {new Date(doc.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => handleDownload(doc.id)} style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#3366a8", fontWeight: 500, fontFamily: "inherit" }}>Download</button>
                          <button onClick={() => handleDelete(doc.id)} style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#c73e3e", fontWeight: 500, fontFamily: "inherit" }}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
