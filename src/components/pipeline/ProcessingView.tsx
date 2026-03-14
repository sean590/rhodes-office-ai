"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { QueueItem } from "@/lib/types/entities";
import { SuccessSummary } from "./SuccessSummary";
import { ApprovalCard } from "./ApprovalCard";

interface ProcessingViewProps {
  batchId: string;
  entities: Array<{ id: string; name: string }>;
  onComplete?: () => void;
  onDocumentsChanged?: () => void;
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
    documents: Array<{
      id: string;
      document_id: string | null;
      name: string;
      type: string;
      type_label: string;
      year: number | null;
      status: string;
    }>;
  }>;
  unassociated_documents: Array<{
    id: string;
    document_id: string | null;
    name: string;
    type: string;
    type_label: string;
    year: number | null;
    status: string;
  }>;
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
  const [liveEntities, setLiveEntities] = useState(initialEntities);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep liveEntities in sync with parent prop
  useEffect(() => {
    if (initialEntities.length > 0) {
      setLiveEntities(initialEntities);
    }
  }, [initialEntities]);

  // Auto-fetch entities if initial list is empty
  useEffect(() => {
    if (initialEntities.length === 0) {
      refreshEntities();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities");
      if (res.ok) {
        const data = await res.json();
        setLiveEntities(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      }
    } catch { /* ignore */ }
  }, []);

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
    fetchBatch();
    pollRef.current = setInterval(fetchBatch, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBatch]);

  // --- Actions ---
  const approveItem = async (itemId: string, excludedActionIndices?: number[]) => {
    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        ...(excludedActionIndices && excludedActionIndices.length > 0
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ excluded_actions: excludedActionIndices }) }
          : {}),
      };
      const res = await fetch(`/api/pipeline/queue/${itemId}/approve`, fetchOptions);
      if (res.ok) {
        const data = await res.json();
        // If a new entity was created, refresh the entities list
        if (data.new_entity_id) {
          await refreshEntities();
        }
      } else {
        console.error("Approve failed:", res.status, await res.json().catch(() => ({})));
      }
    } catch (err) {
      console.error("Approve error:", err);
    }
    await fetchBatch();
    onDocumentsChanged?.();
  };

  const ingestOnly = async (itemId: string) => {
    try {
      const res = await fetch(`/api/pipeline/queue/${itemId}/ingest-only`, { method: "POST" });
      if (!res.ok) console.error("Ingest-only failed:", res.status, await res.json().catch(() => ({})));
    } catch (err) {
      console.error("Ingest-only error:", err);
    }
    await fetchBatch();
    onDocumentsChanged?.();
  };

  const assignEntity = async (itemId: string, entityId: string) => {
    // Update the queue item's entity and clear new_entity signals so approve
    // doesn't create the proposed entity
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staged_entity_id: entityId,
        ai_entity_id: entityId,
      }),
    });
    // Now approve (ingest with the assigned entity)
    await approveItem(itemId);
  };

  const reassignEntity = async (itemId: string, entityId: string) => {
    // Just update the entity assignment without approving
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staged_entity_id: entityId, ai_entity_id: entityId }),
    });
  };

  const updateRelatedEntities = async (itemId: string, relatedEntities: Array<{ entity_id: string; entity_name: string; role: string; confidence: string; reason: string }>) => {
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_related_entities: relatedEntities }),
    });
  };

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
    pollRef.current = setInterval(fetchBatch, 2500);
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
  const ingestedCount = summary ? summary.auto_ingested + summary.approved : 0;
  const allDone = !items.some((i) => i.status === "review_ready" || i.status === "error");

  // Headline
  const totalFileCount = items.filter((i) => !i.parent_queue_id).length;
  let headline: string;
  if (reviewItems.length === 0 && errorItems.length === 0) {
    headline = `${ingestedCount} document${ingestedCount !== 1 ? "s" : ""} ingested from ${totalFileCount} file${totalFileCount !== 1 ? "s" : ""}`;
  } else {
    headline = `${totalFileCount} file${totalFileCount !== 1 ? "s" : ""} processed \u2014 ${ingestedCount} ingested, ${reviewItems.length} need${reviewItems.length === 1 ? "s" : ""} review`;
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
            />
          </div>
        )}

        {/* Needs Review section */}
        {reviewItems.length > 0 && (
          <div style={{ marginBottom: errorItems.length > 0 ? 20 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingTop: 8, borderTop: "1px solid #e8e6df" }}>
              Needs Review
            </div>
            {reviewItems.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                entities={liveEntities}
                onApprove={approveItem}
                onIngestOnly={ingestOnly}
                onAssignEntity={assignEntity}
                onReassignEntity={reassignEntity}
                onUpdateRelatedEntities={updateRelatedEntities}
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
