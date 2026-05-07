"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { QueueItem } from "@/lib/types/entities";
import { SuccessSummary } from "./SuccessSummary";
import { ReviewCard } from "./ReviewCard";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

interface ProcessingViewProps {
  batchId: string;
  entities: Array<{ id: string; name: string }>;
  onComplete?: () => void;
  onDocumentsChanged?: () => void;
}

interface DocSummaryRow {
  id: string;
  document_id: string | null;
  name: string;
  type: string;
  type_label: string;
  year: number | null;
  status: string;
  // Enrichment from migration 057+ (review/chat unification, batch route):
  // shows the linkage chain — investment + transaction summary — so the
  // user can verify what the agent did at a glance instead of clicking
  // into each doc.
  investment_name?: string | null;
  transaction_summary?: string | null;
  is_parent?: boolean;
  child_count?: number;
}

interface BatchSummary {
  total_items: number;
  auto_ingested: number;
  needs_review: number;
  approved: number;
  rejected: number;
  errors: number;
  processing: number;
  entities_affected: Array<{
    entity_id: string | null;
    entity_name: string;
    documents: DocSummaryRow[];
  }>;
  unassociated_documents: DocSummaryRow[];
  parent_documents?: DocSummaryRow[];
}

const STATUS_ICONS: Record<string, string> = {
  queued: "\u00B7",
  extracting: "\u2022",
  review_ready: "\u2713",
  auto_ingested: "\u2713",
  approved: "\u2713",
  rejected: "\u2717",
  error: "\u2717",
};

export function ProcessingView({ batchId, entities: initialEntities, onComplete, onDocumentsChanged }: ProcessingViewProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [phase, setPhase] = useState<"processing" | "results">("processing");
  const [fetchedEntities, setFetchedEntities] = useState<Array<{ id: string; name: string }>>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatPanel = useChatPanel();

  // Derive liveEntities: prefer parent prop, fall back to fetched
  const liveEntities = initialEntities.length > 0 ? initialEntities : fetchedEntities;

  const refreshEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities");
      if (res.ok) {
        const data = await res.json();
        setFetchedEntities(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-fetch entities if initial list is empty
  useEffect(() => {
    if (initialEntities.length === 0) {
      refreshEntities(); // eslint-disable-line react-hooks/set-state-in-effect -- data fetch on mount
    }
  }, [initialEntities.length, refreshEntities]);

  const fetchBatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipeline/batches/${batchId}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || null);

      // Transition to results when no more processing
      // "staged" = waiting for process endpoint, "extracted" = mid-auto-ingest
      const allItems = data.items || [];
      const ACTIVE_STATUSES = ["staged", "queued", "extracting", "extracted"];
      const stillProcessing = allItems.some(
        (i: QueueItem) => ACTIVE_STATUSES.includes(i.status)
      );
      if (!stillProcessing && allItems.length > 0) {
        setPhase((prev) => {
          // When transitioning from processing → results, refresh documents
          // (auto-ingested items created documents during processing)
          if (prev === "processing") {
            onDocumentsChanged?.();
          }
          return "results";
        });
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [batchId, onDocumentsChanged]);

  useEffect(() => {
    fetchBatch(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch + polling
    pollRef.current = setInterval(fetchBatch, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBatch]);

  // --- Actions ---
  // Per-item approval is owned by ReviewCard now (it composes the actions
  // and POSTs to /api/chat/apply-actions). What's left here is just the
  // "retry an errored item" affordance.
  const retryItem = async (itemId: string) => {
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued" }),
    });
    await fetch(`/api/pipeline/batches/${batchId}/process`, { method: "POST" });
    // Resume polling — clear any existing interval first to prevent stacking
    if (pollRef.current) clearInterval(pollRef.current);
    setPhase("processing");
    pollRef.current = setInterval(fetchBatch, 1000);
    await fetchBatch();
  };

  if (items.length === 0 && !summary) return null;

  // --- Processing Phase ---
  if (phase === "processing") {
    // Group by parent files (non-child items only for progress display)
    const parentItems = items.filter((i) => !i.parent_queue_id);
    const childMap = new Map<string, QueueItem[]>();
    for (const item of items) {
      if (item.parent_queue_id) {
        const arr = childMap.get(item.parent_queue_id) || [];
        arr.push(item);
        childMap.set(item.parent_queue_id, arr);
      }
    }

    const totalFiles = parentItems.length;
    const completedFiles = parentItems.filter(
      (i) => !["staged", "queued", "extracting"].includes(i.status)
    ).length;
    const extractingFiles = parentItems.filter((i) => i.status === "extracting").length;
    const pct = totalFiles > 0 ? ((completedFiles + extractingFiles * 0.5) / totalFiles) * 100 : 0;

    return (
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <style>{`
          @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#1a1a1f", marginBottom: 12 }}>
            <div style={{
              width: 16, height: 16, border: "2px solid #e8e6df", borderTopColor: "#2d5a3d",
              borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0,
            }} />
            Processing {totalFiles} file{totalFiles !== 1 ? "s" : ""}...
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, background: "#e8e6df", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
            <div style={{
              height: "100%",
              background: extractingFiles > 0
                ? "linear-gradient(90deg, #2d5a3d 0%, #3d7a5d 50%, #2d5a3d 100%)"
                : "#2d5a3d",
              backgroundSize: extractingFiles > 0 ? "200% 100%" : undefined,
              animation: extractingFiles > 0 ? "shimmer 1.5s ease-in-out infinite" : undefined,
              borderRadius: 3,
              width: `${Math.max(pct, extractingFiles > 0 ? 5 : 0)}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#9494a0", marginBottom: 16 }}>
            {extractingFiles > 0 && completedFiles === 0
              ? "Analyzing with AI..."
              : `${completedFiles}/${totalFiles} complete`}
          </div>
          {/* File list */}
          {parentItems.map((item) => {
            const children = childMap.get(item.id) || [];
            const childCount = children.length;
            const isExtracting = item.status === "extracting";
            const isDone = !["staged", "queued", "extracting"].includes(item.status);
            const icon = STATUS_ICONS[item.status] || "\u00B7";
            const color = isDone ? "#2d5a3d" : isExtracting ? "#b08000" : "#9494a0";

            return (
              <div key={item.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                fontSize: 12,
              }}>
                <span style={{ color, fontSize: 14, width: 16, textAlign: "center", animation: isExtracting ? "pulse 1.2s ease-in-out infinite" : undefined }}>{icon}</span>
                <span style={{
                  color: isDone ? "#1a1a1f" : "#9494a0",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {item.original_filename}
                </span>
                <span style={{ color: "#9494a0", fontSize: 11, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  {isExtracting ? (
                    <>
                      <div style={{
                        width: 10, height: 10, border: "1.5px solid #e8e6df", borderTopColor: "#b08000",
                        borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0,
                      }} />
                      extracting...
                    </>
                  ) : isDone
                    ? (childCount > 0 ? `${childCount + 1} docs extracted` : "1 doc extracted")
                    : "queued"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  // --- Results Phase ---
  const reviewItems = items.filter((i) => i.status === "review_ready");
  const errorItems = items.filter((i) => i.status === "error");
  const lockedItems = items.filter((i) => i.status === "password_required");
  const ingestedCount = summary ? summary.auto_ingested + summary.approved : 0;
  const allDone = !items.some(
    (i) => i.status === "review_ready" || i.status === "error" || i.status === "password_required",
  );

  // Headline
  const totalFileCount = items.filter((i) => !i.parent_queue_id).length;
  let headline: string;
  if (reviewItems.length === 0 && errorItems.length === 0 && lockedItems.length === 0) {
    headline = `${ingestedCount} document${ingestedCount !== 1 ? "s" : ""} ingested from ${totalFileCount} file${totalFileCount !== 1 ? "s" : ""}`;
  } else {
    const parts: string[] = [];
    if (ingestedCount > 0) parts.push(`${ingestedCount} ingested`);
    if (reviewItems.length > 0) parts.push(`${reviewItems.length} need${reviewItems.length === 1 ? "s" : ""} review`);
    if (lockedItems.length > 0) parts.push(`${lockedItems.length} need${lockedItems.length === 1 ? "s" : ""} a password`);
    headline = `${totalFileCount} file${totalFileCount !== 1 ? "s" : ""} processed \u2014 ${parts.join(", ")}`;
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px" }}>
        {/* Headline */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {allDone && <span style={{ color: "#2d5a3d", fontSize: 16 }}>&#10003;</span>}
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>{headline}</span>
          </div>
          {allDone && onComplete && (
            <Button variant="primary" size="sm" onClick={onComplete}>Done</Button>
          )}
        </div>

        {/* Ingested section */}
        {summary && (ingestedCount > 0) && (
          <div style={{ marginBottom: reviewItems.length > 0 ? 20 : 0 }}>
            {reviewItems.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Ingested
              </div>
            )}
            <SuccessSummary
              entitiesAffected={summary.entities_affected}
              unassociatedDocuments={summary.unassociated_documents}
              parentDocuments={summary.parent_documents ?? []}
            />
          </div>
        )}

        {/* Needs Review section */}
        {reviewItems.length > 0 && (
          <div style={{ marginBottom: errorItems.length > 0 ? 20 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingTop: 8, borderTop: "1px solid #e8e6df" }}>
              Needs Review
            </div>
            {reviewItems.map((item) => {
              // Legacy items (pre-agent / pre-unification) won't have a
              // chat_session_id. Render them as a stub message so they're
              // not invisible — the user can still reject or open the
              // doc directly. Drain these via SQL or by re-uploading.
              if (!item.chat_session_id) {
                return (
                  <div
                    key={item.id}
                    style={{
                      background: "#f8f7f4",
                      border: "1px solid #e8e6df",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 12,
                      fontSize: 12,
                      color: "#6b6b76",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#1a1a1f", marginBottom: 4 }}>
                      {item.original_filename}
                    </div>
                    Legacy queue item from before the review/chat unification —
                    re-upload or reject to clear.
                  </div>
                );
              }
              return (
                <ReviewCard
                  key={item.id}
                  item={{
                    id: item.id,
                    document_id: item.document_id,
                    chat_session_id: item.chat_session_id,
                    ai_summary: item.ai_summary,
                    ai_entity_id: item.ai_entity_id,
                    ai_document_type: item.ai_document_type,
                    ai_document_category: item.ai_document_category,
                    ai_year: item.ai_year,
                    original_filename: item.original_filename,
                  }}
                  entities={liveEntities}
                  onSubmitted={fetchBatch}
                  onOpenChat={(sessionId) =>
                    chatPanel.open(undefined, undefined, sessionId)
                  }
                />
              );
            })}
          </div>
        )}

        {/* Needs Passwords section — inline unlock UI for password-protected
            PDFs that paused during extraction. The chat drawer also shows a
            password_request message for the same items; either entry point
            unlocks them. */}
        {lockedItems.length > 0 && (
          <div style={{ marginBottom: errorItems.length > 0 ? 20 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#c47520", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingTop: 8, borderTop: "1px solid #e8e6df" }}>
              Needs Passwords
            </div>
            <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 8 }}>
              Enter the password below or share it in chat — Claude will unlock it.
            </div>
            {lockedItems.map((item) => (
              <LockedQueueItem
                key={item.id}
                itemId={item.id}
                filename={item.original_filename}
                onUnlocked={fetchBatch}
              />
            ))}
          </div>
        )}

        {/* Errors section */}
        {errorItems.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#c73e3e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingTop: 8, borderTop: "1px solid #e8e6df" }}>
              Errors
            </div>
            {errorItems.map((item) => (
              <div key={item.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 0", fontSize: 12,
              }}>
                <span style={{ color: "#c73e3e" }}>&#10007;</span>
                <span style={{ flex: 1, color: "#1a1a1f" }}>{item.original_filename}</span>
                <span style={{ fontSize: 11, color: "#c73e3e" }}>
                  {item.extraction_error || "Extraction failed"}
                </span>
                <Button size="sm" variant="secondary" onClick={() => retryItem(item.id)}>
                  Retry
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  LockedQueueItem                                                    */
/* ------------------------------------------------------------------ */

// Inline unlock form for one password-protected queue item. Mirrors the
// shape used by the /review page's LockedItemRow but stripped of source
// context (this component already lives inside a single batch view).
function LockedQueueItem({
  itemId,
  filename,
  onUnlocked,
}: {
  itemId: string;
  filename: string;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/queue/${itemId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        onUnlocked();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(typeof body?.error === "string" ? body.error : "Unlock failed");
    } catch {
      setError("Unlock failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid #f0eeea",
      }}
    >
      <span
        aria-label="Locked"
        style={{
          width: 22, height: 22, borderRadius: 5,
          background: "rgba(196,117,32,0.1)", color: "#c47520",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#1a1a1f" }}>{filename}</div>
        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            value={password}
            disabled={busy}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Enter password"
            style={{
              flex: 1, minWidth: 180,
              padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
              background: "#fafaf7",
              border: `1px solid ${error ? "#c44520" : "#ddd9d0"}`,
              borderRadius: 6, outline: "none",
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !password}
            onClick={submit}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </div>
        {error && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#c44520" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
