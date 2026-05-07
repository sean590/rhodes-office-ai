"use client";

// /review — the home base for managing incoming documents and pending
// actions. Replaces the Coming-Soon stub from PR A.1.
//
// Three sections (top → bottom):
//   A. Bulk upload drop zone — drop any number of files; goes straight to
//      the pipeline as a "review_page" batch.
//   B. Pending actions queue — flat list of all review_ready queue items
//      across the org, with checkboxes for selective approval and bulk
//      "Approve All" / "Reject" controls.
//   C. Recent batch history — the last 20 batches (newest first) with link
//      to /batches/[id] for per-batch detail.
//
// Live updates piggyback on the same Realtime subscription pattern as the
// NotificationBell — listen on document_batches and refetch on any change.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadFilesToBatch } from "@/lib/utils/batch-upload";
import { UploadIcon, DownIcon } from "@/components/ui/icons";

interface ProposedAction {
  action: string;
  data?: Record<string, unknown>;
  reason?: string;
}

interface QueueItem {
  id: string;
  batch_id: string;
  status: string;
  document_name: string;
  document_type: string | null;
  document_type_label: string | null;
  entity_id: string | null;
  entity_name: string | null;
  year: number | null;
  proposed_actions: ProposedAction[];
  proposed_actions_count: number;
  ai_summary: string | null;
  approval_reason: string | null;
  created_at: string;
  batch: {
    id: string;
    name: string | null;
    context: string;
    created_at: string;
    session_id: string | null;
  } | null;
}

// Compact one-liner summary for a proposed action — the "middle ground"
// between hiding action detail (just a count) and the full editable form on
// /batches/[id]. Just enough to let the reviewer recognize what they're
// approving without clicking through. The richer ApprovalCard is still the
// place to edit values; this is read-only context.
function summarizeAction(a: ProposedAction): string {
  const d = (a.data ?? {}) as Record<string, unknown>;
  const truncate = (s: unknown, n = 60) => {
    const str = String(s ?? "");
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
  };
  switch (a.action) {
    case "update_entity": {
      const fields = (d.fields as Record<string, unknown>) || {};
      const keys = Object.keys(fields);
      if (keys.length === 0) return "Update entity";
      const head = keys.slice(0, 2)
        .map((k) => `${k.replace(/_/g, " ")}`)
        .join(", ");
      return `Update entity: ${head}${keys.length > 2 ? `, +${keys.length - 2} more` : ""}`;
    }
    case "create_entity": {
      const t = d.type ? ` (${String(d.type).replace(/_/g, " ")})` : "";
      return `Create entity: ${d.name ?? "—"}${t}`;
    }
    case "complete_obligation": {
      const parts: string[] = [];
      if (d.completed_at) parts.push(`filed ${d.completed_at}`);
      if (d.confirmation) parts.push(`Conf# ${truncate(d.confirmation, 30)}`);
      return `Complete obligation${parts.length ? `: ${parts.join(" · ")}` : ""}`;
    }
    case "update_registration": {
      const parts: string[] = [];
      if (d.last_filing_date) parts.push(`last filed ${d.last_filing_date}`);
      if (d.state_id) parts.push(`state #${d.state_id}`);
      return `Update registration${parts.length ? `: ${parts.join(" · ")}` : ""}`;
    }
    case "add_registration":
      return `Add ${d.jurisdiction ?? ""} registration${d.qualification_date ? ` (${d.qualification_date})` : ""}`.trim();
    case "add_member": return `Add member: ${d.name ?? "—"}`;
    case "add_manager": return `Add manager: ${d.name ?? "—"}`;
    case "add_role":
    case "add_trust_role":
      return `Add ${(d.role_title ?? d.role ?? "role") as string}: ${d.name ?? "—"}`;
    case "add_partnership_rep": return `Add partnership rep: ${d.name ?? "—"}`;
    case "create_directory_entry": return `Add directory entry: ${d.name ?? "—"}`;
    case "create_relationship": return `Create relationship: ${truncate(d.description ?? d.type, 80)}`;
    case "link_document_to_entity": return "Link document to entity";
    case "link_document_to_investment": return "Link document to investment";
    case "create_investment": return `Create investment: ${d.name ?? "—"}`;
    case "record_investment_transaction": {
      const txType = String(d.transaction_type ?? "transaction").replace(/_/g, " ");
      const amt = d.amount ? `$${Number(d.amount).toLocaleString()}` : "";
      return `Record ${txType}${amt ? `: ${amt}` : ""}${d.transaction_date ? ` on ${d.transaction_date}` : ""}`;
    }
    case "set_investment_allocations": {
      const allocs = d.allocations as Array<unknown> | undefined;
      const n = allocs?.length ?? 0;
      return `Set ${n} allocation${n === 1 ? "" : "s"}`;
    }
    case "update_cap_table":
      return `Update cap table: ${d.investor_name ?? ""}${d.ownership_pct != null ? ` (${d.ownership_pct}%)` : ""}`.trim();
    case "upsert_state_id":
      return `Update state ID: ${d.jurisdiction ?? ""} ${d.state_id ?? ""}`.trim();
    default:
      return a.action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

const ACTION_PREVIEW_LIMIT = 3;

interface BatchRow {
  id: string;
  name: string | null;
  source_type: string;
  status: "staging" | "processing" | "review" | "completed";
  context: string;
  total_documents: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  /** Last updated timestamp — used as the "completed at" proxy for the
   *  Recently Approved section since updateBatchStats runs as part of the
   *  status transition to 'completed'. */
  updated_at: string;
  /** Live progress for in-progress batches (staging/processing). The worker
   *  only writes the rolled-up `*_count` columns once at the end of a batch,
   *  so the API computes this from queue rows on the fly. Absent on
   *  review/completed batches. */
  progress?: { processed: number; total: number };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function batchSourceLabel(b: { context: string; session_id: string | null } | null): string {
  if (!b) return "Upload";
  if (b.context === "onboarding") return "Onboarding";
  if (b.context === "review_page") return "Review page upload";
  if (b.session_id) return "Chat upload";
  if (b.context === "entity") return "Entity upload";
  return "Document upload";
}

export default function ReviewPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [lockedItems, setLockedItems] = useState<QueueItem[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Bulk action state
  const [acting, setActing] = useState(false);

  const refresh = useMemo(() => {
    return async () => {
      try {
        const [queueRes, lockedRes, batchesRes] = await Promise.all([
          fetch("/api/pipeline/queue?status=review_ready&limit=200"),
          fetch("/api/pipeline/queue?status=password_required&limit=100"),
          fetch("/api/pipeline/batches?limit=50"),
        ]);
        if (queueRes.ok) setItems((await queueRes.json()) as QueueItem[]);
        if (lockedRes.ok) setLockedItems((await lockedRes.json()) as QueueItem[]);
        if (batchesRes.ok) setBatches((await batchesRes.json()) as BatchRow[]);
      } catch { /* ignore */ }
      setLoading(false);
    };
  }, []);

  // Initial load + Realtime: refetch on any change to document_batches
  // (pipeline progress is reflected via batch status transitions).
  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("review-page-batches")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "document_batches" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "document_batches" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadFilesToBatch(arr, {
        context: "review_page",
        name: `Review page upload — ${arr.length} document${arr.length === 1 ? "" : "s"}`,
      });
      // Realtime will refetch; nudge it locally too so the new batch appears
      // immediately in Section C.
      refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (checked.size === items.length) setChecked(new Set());
    else setChecked(new Set(items.map((i) => i.id)));
  };

  const approveItems = async (ids: string[]) => {
    if (ids.length === 0) return;
    setActing(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/pipeline/queue/${id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
      if (failed.length > 0) {
        setUploadError(`${failed.length} action${failed.length === 1 ? "" : "s"} failed to approve`);
      }
      // Drop them locally; Realtime will follow up.
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setChecked((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      refresh();
    } finally {
      setActing(false);
    }
  };

  const rejectItems = async (ids: string[]) => {
    if (ids.length === 0) return;
    setActing(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/pipeline/queue/${id}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
      if (failed.length > 0) {
        setUploadError(`${failed.length} item${failed.length === 1 ? "" : "s"} failed to reject`);
      }
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setChecked((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      refresh();
    } finally {
      setActing(false);
    }
  };

  // Group items by batch so the user can triage a whole upload at once. The
  // batch is what they uploaded; the docs inside are what the pipeline split
  // it into. Newest batch first; preserve batch insertion order from the API
  // (already sorted by created_at desc).
  const groupedBatches = useMemo(() => {
    const map = new Map<string, { key: string; batch: QueueItem["batch"]; items: QueueItem[] }>();
    for (const item of items) {
      const key = item.batch?.id ?? item.batch_id ?? "__nobatch";
      const existing = map.get(key);
      if (existing) existing.items.push(item);
      else map.set(key, { key, batch: item.batch, items: [item] });
    }
    return Array.from(map.values()).sort((a, b) => {
      const at = a.batch?.created_at ? new Date(a.batch.created_at).getTime() : 0;
      const bt = b.batch?.created_at ? new Date(b.batch.created_at).getTime() : 0;
      return bt - at;
    });
  }, [items]);

  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const toggleBatchCollapse = (key: string) => {
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const inProgressBatches = batches.filter(
    (b) => b.status === "staging" || b.status === "processing",
  );
  // Recently approved/completed batches — sorted by completion time desc
  // (uses updated_at as the completion proxy, since updateBatchStats runs
  // when the batch transitions to 'completed'). Capped at 10 — the section
  // is the success-acknowledgment surface, not a full audit log.
  const recentCompleted = batches
    .filter((b) => b.status === "completed")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ marginBottom: 6, fontSize: 12, color: "#6b6b76" }}>
        <Link href="/dashboard" style={{ color: "#6b6b76", textDecoration: "none" }}>Dashboard</Link>
        <span style={{ color: "#ddd9d0", margin: "0 6px" }}>/</span>
        <span style={{ color: "#1a1a1f" }}>Review</span>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 600, color: "#1a1a1f", letterSpacing: "-0.02em", margin: 0 }}>
        Review all pending actions
      </h1>
      <p style={{ fontSize: 13, color: "#6b6b76", margin: "6px 0 0 0" }}>
        Upload documents in bulk, review what the pipeline found, and approve actions across all batches.
      </p>

      {/* ── Section A: drop zone ─────────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          marginTop: 24,
          padding: "32px 20px",
          border: `2px dashed ${dragOver ? "#2d5a3d" : "#ddd9d0"}`,
          borderRadius: 12,
          background: dragOver ? "rgba(45,90,61,0.04)" : "#fafaf7",
          textAlign: "center",
          transition: "background 0.15s, border-color 0.15s",
        }}
      >
        <label style={{ cursor: uploading ? "default" : "pointer", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <UploadIcon size={20} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
            {uploading ? "Uploading…" : "Drop documents here to process them"}
          </div>
          <div style={{ fontSize: 12, color: "#6b6b76" }}>
            or click to browse — any number of files
          </div>
          <input
            type="file"
            multiple
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </label>
      </div>
      {uploadError && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#c44520" }}>{uploadError}</div>
      )}

      {/* ── Section A.1: in-progress batches ─────────────────────────── */}
      {inProgressBatches.length > 0 && (
        <div style={{
          marginTop: 24,
          background: "#fff", border: "1px solid #ddd9d0", borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #f0eeea",
            fontSize: 12, fontWeight: 600, color: "#1a1a1f",
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Processing now
          </div>
          {inProgressBatches.map((b) => {
            const sessionId = (b.metadata as { session_id?: string } | null)?.session_id ?? null;
            const total = b.progress?.total ?? b.total_documents ?? 0;
            const processed = b.progress?.processed ?? 0;
            const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
            return (
              <div key={b.id} style={{
                padding: "12px 16px",
                borderBottom: "1px solid #f0eeea",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                {/* Animated dot — orange while processing, slower pulse so
                    it doesn't feel frantic next to the percent number. */}
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#c47520", flexShrink: 0,
                  animation: "batchPulse 1.6s ease-in-out infinite",
                }} />
                <style>{`@keyframes batchPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }`}</style>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                    {b.name || `${total} document${total === 1 ? "" : "s"}`}
                  </div>
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
                    {batchSourceLabel({ context: b.context, session_id: sessionId })}
                    {" · "}
                    {b.progress
                      ? `${processed} of ${total} processed`
                      : `${total} document${total === 1 ? "" : "s"}`}
                    {" · "}
                    {relativeTime(b.created_at)}
                  </div>
                  {b.progress && total > 0 && (
                    <div style={{
                      marginTop: 6, height: 4, borderRadius: 2,
                      background: "#f0eeea", overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${pct}%`, height: "100%",
                        background: "#c47520", transition: "width 0.3s",
                      }} />
                    </div>
                  )}
                </div>
                <Link
                  href={`/batches/${b.id}`}
                  style={{
                    fontSize: 12, fontWeight: 500, color: "#2d5a3d",
                    textDecoration: "none", flexShrink: 0,
                    padding: "6px 4px",
                  }}
                >
                  Open →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Section A.2: locked documents (need passwords) ───────────── */}
      {lockedItems.length > 0 && (
        <div style={{
          marginTop: 24,
          background: "#fff", border: "1px solid #ddd9d0", borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #f0eeea",
            fontSize: 12, fontWeight: 600, color: "#1a1a1f",
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Needs passwords
          </div>
          <div style={{ padding: "8px 16px 4px", fontSize: 12, color: "#6b6b76" }}>
            Enter the password below or share it in chat — Claude will unlock it.
          </div>
          {lockedItems.map((item) => (
            <LockedItemRow
              key={item.id}
              item={item}
              onUnlocked={refresh}
            />
          ))}
        </div>
      )}

      {/* ── Section B: pending actions queue ─────────────────────────── */}
      <div style={{
        marginTop: 32,
        background: "#fff", border: "1px solid #ddd9d0", borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 16px",
          borderBottom: "1px solid #f0eeea",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
              {items.length} {items.length === 1 ? "document" : "documents"} pending review
              {groupedBatches.length > 1 && (
                <span style={{ fontWeight: 400, color: "#6b6b76" }}>
                  {" "}across {groupedBatches.length} batches
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>
              Items the pipeline finished extracting and needs you to approve.
            </div>
          </div>
          {items.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {/* Reject Selected only appears once items are checked — keeps
                  the destructive action out of the way until intent is
                  signaled, and avoids tempting "Reject All" by omission. */}
              {checked.size > 0 && (
                <button
                  disabled={acting}
                  onClick={() => rejectItems(Array.from(checked))}
                  style={{
                    padding: "8px 14px", fontSize: 13, fontWeight: 600,
                    color: "#a83333",
                    background: "transparent",
                    border: "1px solid rgba(168,51,51,0.25)", borderRadius: 6,
                    cursor: acting ? "default" : "pointer",
                    opacity: acting ? 0.7 : 1,
                  }}
                >
                  Reject Selected ({checked.size})
                </button>
              )}
              <button
                disabled={acting || checked.size === 0}
                onClick={() => approveItems(Array.from(checked))}
                style={{
                  padding: "8px 14px", fontSize: 13, fontWeight: 600,
                  color: "#fff",
                  background: checked.size === 0 ? "#9494a0" : "#2d5a3d",
                  border: "none", borderRadius: 6,
                  cursor: checked.size === 0 || acting ? "default" : "pointer",
                  opacity: acting ? 0.7 : 1,
                }}
              >
                Approve Selected ({checked.size})
              </button>
              <button
                disabled={acting}
                onClick={() => approveItems(items.map((i) => i.id))}
                style={{
                  padding: "8px 14px", fontSize: 13, fontWeight: 600,
                  color: "#2d5a3d",
                  background: "rgba(45,90,61,0.08)",
                  border: "1px solid rgba(45,90,61,0.2)", borderRadius: 6,
                  cursor: acting ? "default" : "pointer",
                  opacity: acting ? 0.7 : 1,
                }}
              >
                Approve All ({items.length})
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
            Nothing to review right now. Upload documents above to get started.
          </div>
        ) : (
          <>
            <div style={{
              padding: "8px 16px", borderBottom: "1px solid #f0eeea",
              fontSize: 11, fontWeight: 600, color: "#6b6b76",
              textTransform: "uppercase", letterSpacing: "0.05em",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <input
                type="checkbox"
                checked={items.length > 0 && checked.size === items.length}
                onChange={toggleAll}
                style={{ cursor: "pointer" }}
              />
              <span>Document</span>
            </div>
            {groupedBatches.map(({ key: groupKey, batch, items: groupItems }) => {
              const isCollapsed = collapsedBatches.has(groupKey);
              const sectionLabel = batch
                ? batchSourceLabel(batch)
                : "Other";
              const sectionTitle = batch?.name || sectionLabel;
              return (
                <div key={groupKey}>
                  {/* Batch section header — clickable anywhere on the title
                      area to collapse, plus a one-shot "Approve all in
                      batch" CTA. The destructive counterpart (rejecting a
                      whole batch) is intentionally not exposed here; users
                      can still cross-batch reject via the top header's
                      "Reject Selected" once they've ticked individual rows. */}
                  <div style={{
                    padding: "10px 16px",
                    background: "#f7f5ee",
                    borderBottom: "1px solid #f0eeea",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <button
                      onClick={() => toggleBatchCollapse(groupKey)}
                      aria-label={isCollapsed ? "Expand batch" : "Collapse batch"}
                      style={{
                        flex: 1, minWidth: 0,
                        display: "flex", alignItems: "center", gap: 10,
                        background: "none", border: "none", cursor: "pointer",
                        padding: 0, fontFamily: "inherit", textAlign: "left",
                      }}
                    >
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 18, height: 18,
                        color: "#1a1a1f",
                        transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                        flexShrink: 0,
                      }}>
                        <DownIcon size={16} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          display: "block",
                          fontSize: 13, fontWeight: 600, color: "#1a1a1f",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {sectionTitle}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "#9494a0", marginTop: 1 }}>
                          {sectionLabel}
                          {batch?.created_at && ` · ${relativeTime(batch.created_at)}`}
                          {" · "}
                          {groupItems.length} pending
                        </span>
                      </span>
                    </button>
                    <button
                      disabled={acting}
                      onClick={() => approveItems(groupItems.map((i) => i.id))}
                      style={{
                        padding: "6px 12px", fontSize: 12, fontWeight: 600,
                        color: "#2d5a3d",
                        background: "rgba(45,90,61,0.08)",
                        border: "1px solid rgba(45,90,61,0.2)", borderRadius: 6,
                        cursor: acting ? "default" : "pointer",
                        opacity: acting ? 0.7 : 1,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Approve all in batch ({groupItems.length})
                    </button>
                    {batch && (
                      <Link
                        href={`/batches/${batch.id}`}
                        style={{
                          fontSize: 12, fontWeight: 500, color: "#2d5a3d",
                          textDecoration: "none", flexShrink: 0,
                          padding: "6px 4px",
                        }}
                      >
                        Open →
                      </Link>
                    )}
                  </div>

                  {!isCollapsed && groupItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: "12px 16px 12px 36px",
                        borderBottom: "1px solid #f0eeea",
                        display: "flex", alignItems: "flex-start", gap: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(item.id)}
                        onChange={() => toggle(item.id)}
                        style={{ cursor: "pointer", marginTop: 3, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                          {item.document_name}
                          {item.year && (
                            <span style={{ marginLeft: 6, fontWeight: 400, color: "#6b6b76" }}>
                              ({item.year})
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "#6b6b76", display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {item.document_type_label && (
                            <span style={{
                              padding: "2px 8px", borderRadius: 4,
                              background: "rgba(51,102,168,0.08)", color: "#3366a8",
                              fontSize: 11, fontWeight: 600,
                            }}>
                              {item.document_type_label}
                            </span>
                          )}
                          {item.entity_name && (
                            <span>→ {item.entity_name}</span>
                          )}
                          {item.proposed_actions_count > 0 && (
                            <span>
                              {item.proposed_actions_count} {item.proposed_actions_count === 1 ? "action" : "actions"}
                            </span>
                          )}
                        </div>
                        {item.proposed_actions.length > 0 && (
                          <ul style={{
                            margin: "6px 0 0 0", padding: 0, listStyle: "none",
                            fontSize: 12, color: "#6b6b76", lineHeight: 1.55,
                          }}>
                            {item.proposed_actions.slice(0, ACTION_PREVIEW_LIMIT).map((a, idx) => (
                              <li key={idx} style={{ display: "flex", gap: 6 }}>
                                <span style={{ color: "#9494a0" }}>•</span>
                                <span>{summarizeAction(a)}</span>
                              </li>
                            ))}
                            {item.proposed_actions.length > ACTION_PREVIEW_LIMIT && (
                              <li style={{ color: "#9494a0", fontStyle: "italic", paddingLeft: 12 }}>
                                + {item.proposed_actions.length - ACTION_PREVIEW_LIMIT} more
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                      <button
                        disabled={acting}
                        onClick={() => rejectItems([item.id])}
                        title="Reject"
                        style={{
                          padding: "4px 10px", fontSize: 11, fontWeight: 500,
                          color: "#a83333", background: "transparent",
                          border: "1px solid #ddd9d0", borderRadius: 6,
                          cursor: acting ? "default" : "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── Section C: recently approved batches ─────────────────────── */}
      {/* Always render so the user has an "I just did that" confirmation
          surface — disappearing rows from Section B were the original
          complaint. Empty state nudges first-timers. */}
      <div style={{ marginTop: 32 }}>
        <div style={{
          display: "flex", alignItems: "center",
          marginBottom: 8, gap: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
            Recently approved
          </div>
          {recentCompleted.length > 0 && (
            <span style={{ fontSize: 12, color: "#9494a0" }}>
              · last {recentCompleted.length}
            </span>
          )}
        </div>
        <div style={{
          background: "#fff", border: "1px solid #ddd9d0", borderRadius: 12,
          overflow: "hidden",
        }}>
          {recentCompleted.length === 0 ? (
            <div style={{
              padding: "24px 16px", fontSize: 13, color: "#9494a0",
              textAlign: "center",
            }}>
              Approved batches will show up here.
            </div>
          ) : recentCompleted.map((b) => {
            const sessionId = (b.metadata as { session_id?: string } | null)?.session_id ?? null;
            return (
              <Link
                key={b.id}
                href={`/batches/${b.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 16px",
                  borderBottom: "1px solid #f0eeea",
                  textDecoration: "none", color: "#1a1a1f",
                }}
              >
                <span
                  aria-label="Approved"
                  style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: "rgba(45,138,78,0.12)", color: "#2d8a4e",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                    {b.name || `${b.total_documents} document${b.total_documents === 1 ? "" : "s"}`}
                  </div>
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
                    {batchSourceLabel({ context: b.context, session_id: sessionId })}
                    {" · "}
                    {b.total_documents} document{b.total_documents === 1 ? "" : "s"}
                    {" · completed "}
                    {relativeTime(b.updated_at)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LockedItemRow                                                      */
/* ------------------------------------------------------------------ */

// One row in the "Needs passwords" section. Owns its own password state +
// busy/error so multiple rows can be unlocked independently. On success
// the parent's refresh() runs and the item drops out of lockedItems on the
// next render. The "or share in chat" link opens the chat drawer; the
// notification message that landed there has the same context.
function LockedItemRow({
  item,
  onUnlocked,
}: {
  item: QueueItem;
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
      const res = await fetch(`/api/pipeline/queue/${item.id}/unlock`, {
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
        padding: "12px 16px",
        borderBottom: "1px solid #f0eeea",
        display: "flex", alignItems: "flex-start", gap: 12,
      }}
    >
      <span
        aria-label="Locked"
        style={{
          width: 24, height: 24, borderRadius: 6,
          background: "rgba(196,117,32,0.1)",
          color: "#c47520",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
          {item.document_name}
        </div>
        <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
          {batchSourceLabel(item.batch)} — {relativeTime(item.created_at)}
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            value={password}
            disabled={busy}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Enter password"
            style={{
              flex: 1, minWidth: 180,
              padding: "6px 10px",
              fontSize: 13, fontFamily: "inherit",
              background: "#fafaf7",
              border: `1px solid ${error ? "#c44520" : "#ddd9d0"}`,
              borderRadius: 6,
              outline: "none",
            }}
          />
          <button
            disabled={busy || !password}
            onClick={submit}
            style={{
              padding: "6px 14px", fontSize: 13, fontWeight: 600,
              color: "#fff",
              background: busy || !password ? "#9494a0" : "#2d5a3d",
              border: "none", borderRadius: 6,
              cursor: busy || !password ? "default" : "pointer",
            }}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#c44520" }}>
            {error}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: "#9494a0" }}>
          Or share the password{" "}
          <Link href="/chat" style={{ color: "#2d5a3d", textDecoration: "none" }}>
            in chat →
          </Link>
        </div>
      </div>
    </div>
  );
}
