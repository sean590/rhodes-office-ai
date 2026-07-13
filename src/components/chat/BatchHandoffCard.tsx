"use client";

// Renders an assistant chat message whose metadata.type === "batch_handoff".
// These are the system-style messages emitted by the chat drawer when a user
// uploads 6+ files at once: instead of running through the MCP orchestrator,
// the files are routed to the pipeline in the background and this card
// surfaces live progress in the conversation.
//
// The card subscribes to Realtime UPDATE events on document_batches scoped
// to its own batch_id, so the status indicator and CTA copy transition in
// place: processing → review → completed. No polling fallback — Realtime is
// already required for the notification bell, so it's an existing dependency.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeSubscribe } from "@/lib/supabase/safe-realtime";

type BatchStatus = "staging" | "processing" | "review" | "completed";

interface BatchHandoffMeta {
  batch_id: string;
  file_count: number;
  filenames: string[];
}

const COLLAPSE_THRESHOLD = 5;

function statusCopy(status: BatchStatus, fileCount: number): {
  headline: string;
  cta: string;
  dotColor: string;
} {
  const docs = `${fileCount} document${fileCount === 1 ? "" : "s"}`;
  switch (status) {
    case "review":
      return {
        headline: `${docs} ready for review`,
        cta: "Review now",
        dotColor: "#c44520",
      };
    case "completed":
      return {
        headline: `${docs} processed`,
        cta: "View details",
        dotColor: "#2d8a4e",
      };
    case "staging":
    case "processing":
    default:
      return {
        headline: `Processing ${docs} in the background…`,
        cta: "View progress",
        dotColor: "#c47520",
      };
  }
}

export function BatchHandoffCard({ metadata }: { metadata: BatchHandoffMeta }) {
  const { batch_id, file_count, filenames } = metadata;
  const [status, setStatus] = useState<BatchStatus>("processing");
  const [expanded, setExpanded] = useState(false);
  // Duplicates the register endpoint detected by content_hash. We pull these
  // from batch.metadata.duplicates (persisted by /upload route) so dedupe
  // never hides — yesterday's K-1 retry silently dropped 5 of 6 files and
  // looked indistinguishable from a clean upload until the user dug into SQL.
  const [duplicates, setDuplicates] = useState<Array<{ filename: string; existing_document_id?: string | null }>>([]);
  const supabase = useMemo(() => createClient(), []);

  // Initial fetch + Realtime subscription on this batch's row only.
  useEffect(() => {
    if (!batch_id) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/pipeline/batches/${batch_id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.status) setStatus(data.status as BatchStatus);
        const dupes = Array.isArray(data?.summary?.duplicates) ? data.summary.duplicates : [];
        setDuplicates(dupes);
      } catch { /* ignore */ }
    })();

    const channel = safeSubscribe(() => supabase
      .channel(`batch-handoff-${batch_id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "document_batches",
          filter: `id=eq.${batch_id}`,
        },
        (payload) => {
          const next = (payload.new as { status?: BatchStatus } | null)?.status;
          if (next) setStatus(next);
        },
      )
      .subscribe());

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, batch_id]);

  // file_count is the raw upload count (always == filenames.length). When
  // dedupe fires, the actual files going through the pipeline is the
  // difference. Use the post-dedupe count for the headline so "Processing 6"
  // doesn't lie when 5 of those 6 dedupe'd silently.
  const newCount = Math.max(0, file_count - duplicates.length);
  const copy = statusCopy(status, newCount);
  const showAll = expanded || filenames.length <= COLLAPSE_THRESHOLD;
  const visibleFiles = showAll ? filenames : filenames.slice(0, COLLAPSE_THRESHOLD);
  const dupedFilenames = new Set(duplicates.map((d) => d.filename));

  return (
    <div style={{
      maxWidth: "85%",
      padding: 14,
      borderRadius: "16px 16px 16px 4px",
      background: "#ffffff",
      border: "1px solid #e8e6df",
      fontSize: 13,
      lineHeight: 1.5,
      color: "#1a1a1f",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: copy.dotColor, flexShrink: 0,
        }} />
        <span style={{ fontWeight: 500 }}>{copy.headline}</span>
      </div>

      {filenames.length > 0 && (
        <div style={{ fontSize: 12, color: "#6b6b76" }}>
          {visibleFiles.map((name, i) => {
            const isDupe = dupedFilenames.has(name);
            return (
              <div key={i} style={{
                padding: "2px 0",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                color: isDupe ? "#9494a0" : "#6b6b76",
              }}>
                · {name}
                {isDupe && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontStyle: "italic" }}>
                    already filed
                  </span>
                )}
              </div>
            );
          })}
          {!showAll && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                marginTop: 4, fontSize: 11, color: "#2d5a3d",
                background: "none", border: "none", cursor: "pointer",
                padding: 0, fontFamily: "inherit",
              }}
            >
              Show {filenames.length - COLLAPSE_THRESHOLD} more
            </button>
          )}
        </div>
      )}

      {duplicates.length > 0 && (
        <div style={{
          fontSize: 11, color: "#6b6b76",
          padding: "6px 8px",
          background: "#f8f7f4",
          borderRadius: 6,
        }}>
          {duplicates.length} of {file_count} {duplicates.length === 1 ? "was" : "were"} already filed and skipped — only {newCount} {newCount === 1 ? "is" : "are"} being processed.
        </div>
      )}

      <Link
        href="/processing"
        style={{
          alignSelf: "flex-start",
          padding: "6px 12px",
          fontSize: 12, fontWeight: 600, color: "#2d5a3d",
          background: "rgba(45,90,61,0.08)", borderRadius: 6,
          textDecoration: "none",
        }}
      >
        {copy.cta} →
      </Link>
    </div>
  );
}
