"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface BatchRow {
  id: string;
  name: string | null;
  source_type: string;
  status: "staging" | "processing" | "review" | "completed";
  context: string;
  total_documents: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
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

function batchSourceLabel(b: BatchRow): string {
  if (b.context === "onboarding") return "Onboarding";
  // chat-originated batches are tagged via metadata.session_id by the chat drawer.
  const sessionId = (b.metadata as { session_id?: string } | null)?.session_id;
  if (sessionId) return "Chat upload";
  if (b.context === "entity") return "Entity upload";
  return "Document upload";
}

function statusLine(b: BatchRow): string {
  const n = b.total_documents || 0;
  const docs = `${n} document${n === 1 ? "" : "s"}`;
  switch (b.status) {
    case "review":
      return `${docs} ready for review`;
    case "processing":
      return `${docs} processing...`;
    case "staging":
      return `${docs} preparing...`;
    case "completed":
      return `${docs} processed`;
    default:
      return docs;
  }
}

export function NotificationBell() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Single effect: initial fetch + Realtime subscription. On any INSERT/UPDATE
  // to document_batches, refetch via the org-scoped GET endpoint. We never read
  // the Realtime payload directly — Realtime can't filter by org, so the payload
  // could include rows from other tenants; using it only as a refresh trigger
  // keeps cross-tenant data out of the client.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/pipeline/batches?limit=10");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as BatchRow[];
        if (!cancelled) setBatches(data);
      } catch { /* ignore */ }
    };
    load();

    // Realtime is a best-effort refresh trigger, never load-bearing. Some
    // contexts block the WebSocket (CSP, strict mobile/in-app webviews) and
    // .subscribe() throws synchronously ("The operation is insecure"); since
    // this effect runs in the always-mounted Topbar, an uncaught throw would
    // break the authenticated shell right after login. Swallow it — the bell
    // still works from the initial fetch above.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel("batch-notifications")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "document_batches" }, load)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "document_batches" }, load)
        .subscribe();
    } catch (err) {
      console.warn("NotificationBell: realtime unavailable, falling back to fetch-only", err);
    }

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const reviewCount = batches.filter((b) => b.status === "review").length;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        style={{
          width: 34, height: 34, borderRadius: 7, border: "none",
          background: open ? "#e8e6df" : "transparent",
          color: "#6b6b76", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {reviewCount > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            minWidth: 16, height: 16, padding: "0 4px",
            background: "#c44520", color: "#fff",
            borderRadius: 8, fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}>
            {reviewCount > 9 ? "9+" : reviewCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          width: 340, maxHeight: 420,
          background: "#fff", border: "1px solid #ddd9d0",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          zIndex: 100,
          // Flex column: pinned header + scrollable middle + pinned footer.
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Pinned header */}
          <div style={{
            flex: "0 0 auto",
            padding: "10px 14px", borderBottom: "1px solid #f0eeea",
            fontSize: 12, fontWeight: 600, color: "#1a1a1f",
            textTransform: "uppercase", letterSpacing: "0.05em",
            background: "#fff",
          }}>
            Notifications
          </div>

          {/* Scrollable middle */}
          <div style={{
            flex: "1 1 auto", overflowY: "auto", minHeight: 0,
          }}>
            {batches.length === 0 ? (
              <div style={{ padding: "24px 14px", fontSize: 13, color: "#9494a0", textAlign: "center" }}>
                No recent uploads
              </div>
            ) : (
              batches.map((b) => (
                <Link
                  key={b.id}
                  href="/processing"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "block", padding: "10px 14px",
                    borderBottom: "1px solid #f0eeea",
                    textDecoration: "none", color: "#1a1a1f",
                  }}
                >
                  <div style={{
                    fontSize: 13, fontWeight: 500, color: "#1a1a1f",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {b.status === "review" && (
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: "#c44520", flexShrink: 0,
                      }} />
                    )}
                    {b.status === "processing" && (
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: "#c47520", flexShrink: 0,
                      }} />
                    )}
                    <span>{statusLine(b)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>
                    {batchSourceLabel(b)} — {relativeTime(b.created_at)}
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* Pinned footer */}
          <Link
            href="/processing"
            onClick={() => setOpen(false)}
            style={{
              flex: "0 0 auto",
              display: "block", padding: "10px 14px",
              fontSize: 12, fontWeight: 600, color: "#2d5a3d",
              textDecoration: "none", textAlign: "center",
              borderTop: "1px solid #f0eeea",
              background: "#fff",
            }}
          >
            View all processing →
          </Link>
        </div>
      )}
    </div>
  );
}
