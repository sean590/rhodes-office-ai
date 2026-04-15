"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { QueueItem, DocumentBatch } from "@/lib/types/entities";
import { EntityDiscoveryCard } from "./EntityDiscoveryCard";

interface ProcessingProgressProps {
  batchId: string;
  showEntityDiscovery: boolean;
  onComplete?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  extracting: "Extracting...",
  review_ready: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  error: "Error",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "#9494a0",
  extracting: "#b08000",
  review_ready: "#2d5a3d",
  approved: "#2d5a3d",
  rejected: "#c73e3e",
  error: "#c73e3e",
};

export function ProcessingProgress({ batchId, showEntityDiscovery, onComplete }: ProcessingProgressProps) {
  const [batch, setBatch] = useState<DocumentBatch | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [proposedEntities, setProposedEntities] = useState<Record<string, unknown>[]>([]);
  const [approvingAll, setApprovingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipeline/batches/${batchId}`);
      if (!res.ok) return;
      const data = await res.json();
      setBatch(data);
      setItems(data.items || []);
      setProposedEntities(data.proposed_entities || []);

      // Stop polling when all items are done
      const allDone = (data.items || []).every(
        (i: QueueItem) => ["approved", "rejected", "error", "review_ready"].includes(i.status)
      );
      if (allDone && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      // Ignore polling errors
    }
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
    pollRef.current = setInterval(fetchBatch, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBatch]);

  const approveItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/pipeline/queue/${itemId}/approve`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Approve failed:", res.status, body);
      }
    } catch (err) {
      console.error("Approve network error:", err);
    }
    await fetchBatch();
  };

  const rejectItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/pipeline/queue/${itemId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Reject failed:", res.status, body);
      }
    } catch (err) {
      console.error("Reject network error:", err);
    }
    await fetchBatch();
  };

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      const res = await fetch(`/api/pipeline/batches/${batchId}/approve-all`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Approve all failed:", res.status, body);
      }
      await fetchBatch();
    } finally {
      setApprovingAll(false);
    }
  };

  const retryItem = async (itemId: string) => {
    // Re-queue the item for processing
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued" }),
    });
    // Trigger batch processing again
    await fetch(`/api/pipeline/batches/${batchId}/process`, { method: "POST" });
    fetchBatch();
  };

  if (!batch) return null;

  const totalItems = items.length;
  const extractingCount = items.filter((i) => i.status === "extracting").length;
  const completedCount = items.filter((i) =>
    ["approved", "rejected", "error", "review_ready"].includes(i.status)
  ).length;
  // Count extracting items as partial progress (0.5 each) so the bar moves during extraction
  const progressPct = totalItems > 0 ? ((completedCount + extractingCount * 0.5) / totalItems) * 100 : 0;
  const reviewReadyItems = items.filter((i) => i.status === "review_ready");
  const isProcessing = items.some((i) => i.status === "queued" || i.status === "extracting");
  const allDone = items.every((i) => ["approved", "rejected", "error"].includes(i.status));

  // Group items: parent items first, children under them
  const parentItems = items.filter((i) => !i.parent_queue_id);
  const childMap = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (item.parent_queue_id) {
      const children = childMap.get(item.parent_queue_id) || [];
      children.push(item);
      childMap.set(item.parent_queue_id, children);
    }
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {/* Shimmer animation for progress bar during extraction */}
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid #e8e6df",
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
            {isProcessing ? "Processing..." : allDone ? "Complete" : "Review Extractions"}
          </span>
          <span style={{ fontSize: 11, color: "#9494a0", marginLeft: 8 }}>
            {batch.approved_count} approved, {batch.error_count} errors
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {reviewReadyItems.length > 1 && (
            <Button variant="primary" size="sm" onClick={approveAll} disabled={approvingAll}>
              {approvingAll ? "Approving..." : `Approve All (${reviewReadyItems.length})`}
            </Button>
          )}
          {allDone && onComplete && (
            <Button variant="primary" onClick={onComplete}>
              Done
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div style={{ padding: "8px 16px" }}>
          <div style={{
            height: 6,
            background: "#e8e6df",
            borderRadius: 3,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              background: extractingCount > 0
                ? "linear-gradient(90deg, #2d5a3d 0%, #3d7a5d 50%, #2d5a3d 100%)"
                : "#2d5a3d",
              backgroundSize: extractingCount > 0 ? "200% 100%" : undefined,
              animation: extractingCount > 0 ? "shimmer 1.5s ease-in-out infinite" : undefined,
              borderRadius: 3,
              width: `${Math.max(progressPct, extractingCount > 0 ? 5 : 0)}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
            {extractingCount > 0
              ? `Analyzing ${extractingCount} item${extractingCount !== 1 ? "s" : ""}... (${completedCount} of ${totalItems} done)`
              : `${completedCount} of ${totalItems} items processed`}
          </div>
        </div>
      )}

      {/* Entity Discovery */}
      {showEntityDiscovery && proposedEntities.length > 0 && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e6df" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1f", marginBottom: 8 }}>
            Discovered Entities
          </div>
          {proposedEntities.map((entity, i) => (
            <EntityDiscoveryCard
              key={i}
              proposedEntity={entity}
              sourceDocuments={items.filter(
                (it) => JSON.stringify(it.ai_proposed_entity) === JSON.stringify(entity)
              ).map((it) => it.original_filename)}
              onCreateEntity={async (entityData) => {
                // Create entity from proposed entity data
                const res = await fetch("/api/entities", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: entityData.name || "New Entity",
                    type: entityData.type || "llc",
                    formation_state: entityData.formation_state || null,
                    ein: entityData.ein || null,
                  }),
                });
                if (res.ok) {
                  const newEntity = await res.json();
                  // Update all queue items that had this proposed entity to use the real entity
                  const entityName = entityData.name as string;
                  for (const it of items) {
                    const proposed = it.ai_proposed_entity as Record<string, unknown> | null;
                    if (proposed && proposed.name === entityName) {
                      await fetch(`/api/pipeline/queue/${it.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          staged_entity_id: newEntity.id,
                          staged_entity_name: newEntity.name,
                        }),
                      });
                    }
                  }
                }
                fetchBatch();
              }}
              onSkip={() => {}}
            />
          ))}
        </div>
      )}

      {/* Item list */}
      <div style={{ padding: "4px 0 8px" }}>
        {parentItems.map((item, idx) => {
          const children = childMap.get(item.id) || [];
          const isLast = idx === parentItems.length - 1 && children.length === 0;
          return (
            <div key={item.id}>
              <QueueItemRow
                item={item}
                onApprove={() => approveItem(item.id)}
                onReject={() => rejectItem(item.id)}
                onRetry={() => retryItem(item.id)}
                showDivider={!isLast}
              />
              {children.map((child, ci) => {
                const isLastChild = ci === children.length - 1 && idx === parentItems.length - 1;
                return (
                  <QueueItemRow
                    key={child.id}
                    item={child}
                    onApprove={() => approveItem(child.id)}
                    onReject={() => rejectItem(child.id)}
                    onRetry={() => retryItem(child.id)}
                    isChild
                    parentName={item.ai_suggested_name || item.original_filename}
                    showDivider={!isLastChild}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function QueueItemRow({
  item,
  onApprove,
  onReject,
  onRetry,
  isChild = false,
  parentName,
  showDivider = true,
}: {
  item: QueueItem;
  onApprove: () => void;
  onReject: () => void;
  onRetry?: () => void;
  isChild?: boolean;
  parentName?: string;
  showDivider?: boolean;
}) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRejecting(true);
    try {
      await onReject();
    } finally {
      setRejecting(false);
    }
  };

  const docTypeLabel = item.ai_document_type
    ? (DOCUMENT_TYPE_LABELS[item.ai_document_type] || item.ai_document_type)
    : (item.staged_doc_type ? (DOCUMENT_TYPE_LABELS[item.staged_doc_type] || item.staged_doc_type) : "Unknown");

  const hasSummary = item.ai_summary && item.ai_summary.length > 0;
  return (
    <>
      <div
        onClick={hasSummary ? () => setExpanded(!expanded) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          fontSize: 12,
          cursor: hasSummary ? "pointer" : undefined,
        }}
      >
        {/* Status indicator */}
        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: STATUS_COLORS[item.status] || "#9494a0",
          flexShrink: 0,
          alignSelf: "flex-start",
          marginTop: 4,
        }} />

        {/* File info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            color: "#1a1a1f",
            fontWeight: isChild ? 400 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {item.ai_suggested_name || item.original_filename}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#6b6b76" }}>{docTypeLabel}</span>
            {item.ai_year && (
              <span style={{ fontSize: 11, color: "#9494a0" }}>FY{item.ai_year}</span>
            )}
            {item.ai_k1_recipient && (
              <span style={{ fontSize: 11, color: "#7b4db5" }}>{item.ai_k1_recipient}</span>
            )}
            {isChild && parentName && (
              <span style={{
                fontSize: 10,
                color: "#9494a0",
                background: "#f0ede6",
                padding: "1px 6px",
                borderRadius: 3,
              }}>
                from {parentName.length > 30 ? parentName.slice(0, 30) + "..." : parentName}
              </span>
            )}
          </div>
          {item.ai_summary && (
            <div style={{
              fontSize: 11,
              color: "#9494a0",
              marginTop: 2,
              lineHeight: 1.4,
              ...(expanded ? {} : {
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const,
              }),
            }}>
              {item.ai_summary}
            </div>
          )}
          {item.extraction_error && (
            <div style={{ fontSize: 11, color: "#c73e3e", marginTop: 2 }}>
              Error: {item.extraction_error}
            </div>
          )}
        </div>

        {/* Status */}
        <div style={{
          fontSize: 11,
          color: STATUS_COLORS[item.status] || "#9494a0",
          fontWeight: 500,
          whiteSpace: "nowrap",
          alignSelf: "flex-start",
          marginTop: 2,
        }}>
          {STATUS_LABELS[item.status] || item.status}
        </div>

        {/* Actions */}
        {item.status === "review_ready" && (
          <div style={{ display: "flex", gap: 4, alignSelf: "flex-start" }}>
            <Button size="sm" variant="primary" onClick={handleApprove} disabled={approving || rejecting}>
              {approving ? "Approving..." : "Approve"}
            </Button>
            <Button size="sm" variant="secondary" onClick={handleReject} disabled={approving || rejecting}>
              {rejecting ? "..." : "Reject"}
            </Button>
          </div>
        )}

        {item.status === "error" && onRetry && (
          <div style={{ alignSelf: "flex-start" }}>
            <Button size="sm" variant="secondary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRetry(); }}>
              Retry
            </Button>
          </div>
        )}
      </div>
      {showDivider && (
        <div style={{ margin: "0 16px", borderBottom: "1px solid #f0ede6" }} />
      )}
    </>
  );
}
