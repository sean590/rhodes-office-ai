"use client";

/**
 * Processing — the document+state monitor (the reincarnated /review, minus the
 * approvals, which now live in Home → Needs you). Shows every document moving
 * through the pipeline: queued → reading → filed / needs-review / stuck /
 * locked. Retry or cancel stuck items, unlock password-protected PDFs, and
 * "Retry all stuck" in one go. Polls while anything is in flight.
 *
 * "No batch as a UX concept": items carry a human source chip (Chat upload,
 * Upload, …), never a batch id. Approving a needs-review item happens in Home.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProcessingRow, toProcessingState, type ProcessingItem } from "@/components/pipeline/ProcessingRow";
import { Icon } from "@/components/ui/icon";

const ACTIVE_STATUSES = "queued,extracting,review_ready,error,password_required";
const FILED_STATUSES = "approved,auto_ingested";

interface QueueApiItem {
  id: string;
  status: string;
  document_name: string;
  document_type_label: string | null;
  entity_name: string | null;
  extraction_error: string | null;
  created_at: string;
  batch: { context: string; session_id: string | null } | null;
}

function sourceChip(batch: QueueApiItem["batch"]): string {
  if (!batch) return "Upload";
  if (batch.session_id || batch.context === "chat") return "Chat upload";
  switch (batch.context) {
    case "email":
    case "inbound":
    case "inbound_email":
      return "Email";
    case "portal":
    case "portal_pull":
      return "Portal";
    case "onboarding":
      return "Onboarding";
    default:
      return "Upload";
  }
}

function toItem(r: QueueApiItem): ProcessingItem {
  return {
    id: r.id,
    document_name: r.document_name,
    status: r.status,
    entity_name: r.entity_name,
    document_type_label: r.document_type_label,
    source: sourceChip(r.batch),
    created_at: r.created_at,
    extraction_error: r.extraction_error,
  };
}

// Stuck/locked first (need a human), then in-flight, then needs-review.
const STATE_ORDER: Record<string, number> = { stuck: 0, locked: 1, queued: 2, reading: 2, needs_review: 3, filed: 4 };

export default function ProcessingPage() {
  const router = useRouter();
  const [active, setActive] = useState<ProcessingItem[]>([]);
  const [filed, setFiled] = useState<ProcessingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [aRes, fRes] = await Promise.all([
        fetch(`/api/pipeline/queue?status=${ACTIVE_STATUSES}&limit=200`),
        fetch(`/api/pipeline/queue?status=${FILED_STATUSES}&limit=15`),
      ]);
      const aData = aRes.ok ? await aRes.json() : [];
      const fData = fRes.ok ? await fRes.json() : [];
      setActive((Array.isArray(aData) ? aData : []).map(toItem));
      setFiled((Array.isArray(fData) ? fData : []).map(toItem));
    } catch (err) {
      console.error("Failed to load processing queue:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while anything is genuinely in flight (queued/extracting).
  const inFlight = useMemo(
    () => active.some((i) => i.status === "queued" || i.status === "extracting"),
    [active],
  );
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  useEffect(() => {
    if (!inFlight) return;
    // `cancelled` guard: without it, an in-flight fetchData() resolving after
    // cleanup reschedules an orphaned poll loop that survives unmount/re-run.
    let cancelled = false;
    const tick = () => {
      fetchData().finally(() => {
        if (!cancelled) pollRef.current = setTimeout(tick, 3000);
      });
    };
    pollRef.current = setTimeout(tick, 3000);
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [inFlight, fetchData]);

  const withBusy = useCallback(async (id: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    }
  }, []);

  const retry = useCallback((item: ProcessingItem) => withBusy(item.id, async () => {
    const res = await fetch(`/api/pipeline/queue/${item.id}/reprocess`, { method: "POST" });
    if (!res.ok) { setNotice("Couldn't retry that document. Try again."); return; }
    await fetchData();
  }), [withBusy, fetchData]);

  const cancel = useCallback((item: ProcessingItem) => withBusy(item.id, async () => {
    const res = await fetch(`/api/pipeline/queue/${item.id}/reject`, { method: "POST" });
    if (!res.ok) { setNotice("Couldn't cancel that document."); return; }
    await fetchData();
  }), [withBusy, fetchData]);

  const unlock = useCallback((item: ProcessingItem, password: string) => withBusy(item.id, async () => {
    setNotice(null);
    const res = await fetch(`/api/pipeline/queue/${item.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error || "Incorrect password.");
      return;
    }
    await fetchData();
  }), [withBusy, fetchData]);

  const openReview = useCallback(
    (item: ProcessingItem) => router.push(`/home?review=${item.id}`),
    [router],
  );

  const stuckItems = useMemo(() => active.filter((i) => toProcessingState(i.status) === "stuck"), [active]);
  const retryAllStuck = useCallback(async () => {
    for (const item of stuckItems) {
      await withBusy(item.id, async () => {
        await fetch(`/api/pipeline/queue/${item.id}/reprocess`, { method: "POST" });
      });
    }
    await fetchData();
  }, [stuckItems, withBusy, fetchData]);

  const sortedActive = useMemo(
    () => [...active].sort((a, b) => {
      const pa = STATE_ORDER[toProcessingState(a.status)] ?? 9;
      const pb = STATE_ORDER[toProcessingState(b.status)] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.created_at < b.created_at ? 1 : -1;
    }),
    [active],
  );

  // Summary counts.
  const counts = useMemo(() => {
    let processing = 0, stuck = 0, locked = 0, review = 0;
    for (const i of active) {
      const s = toProcessingState(i.status);
      if (s === "queued" || s === "reading") processing++;
      else if (s === "stuck") stuck++;
      else if (s === "locked") locked++;
      else if (s === "needs_review") review++;
    }
    return { processing, stuck, locked, review };
  }, [active]);

  const summaryBits = [
    counts.processing > 0 ? { text: `${counts.processing} processing`, color: "var(--blue)" } : null,
    counts.review > 0 ? { text: `${counts.review} need review`, color: "var(--amber)" } : null,
    counts.locked > 0 ? { text: `${counts.locked} locked`, color: "var(--amber)" } : null,
    counts.stuck > 0 ? { text: `${counts.stuck} stuck`, color: "var(--red)" } : null,
  ].filter(Boolean) as { text: string; color: string }[];

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.02em" }}>Processing</h1>
        {stuckItems.length > 0 && (
          <button
            onClick={retryAllStuck}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--card)", color: "var(--red)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="refresh" size={14} /> Retry all stuck
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px" }}>
        Documents moving through the pipeline. Approvals live in{" "}
        <button onClick={() => router.push("/home")} style={{ background: "none", border: "none", padding: 0, color: "var(--green)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Home</button>.
      </p>

      {summaryBits.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "12px 0 16px" }}>
          {summaryBits.map((b, i) => (
            <span key={b.text} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "var(--faint)" }}>·</span>}
              <span style={{ fontSize: 13, fontWeight: 600, color: b.color }}>{b.text}</span>
            </span>
          ))}
        </div>
      )}

      {notice && (
        <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-50)", border: "1px solid var(--red)", borderRadius: "var(--radius-sm)", padding: "8px 12px", marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Loading…</div>
      ) : active.length === 0 && filed.length === 0 ? (
        <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--muted)" }}>
          <Icon name="circle-check" size={28} color="var(--green)" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginTop: 10 }}>Nothing processing</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Drop documents in chat and they&rsquo;ll show up here as they&rsquo;re read.</div>
        </div>
      ) : (
        <>
          {sortedActive.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "4px 16px", marginBottom: 20 }}>
              {sortedActive.map((item) => (
                <ProcessingRow
                  key={item.id}
                  item={item}
                  busy={busy.has(item.id)}
                  onRetry={retry}
                  onCancel={cancel}
                  onUnlock={unlock}
                  onOpenReview={openReview}
                />
              ))}
            </div>
          )}

          {filed.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px 4px" }}>Recently filed</div>
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "4px 16px" }}>
                {filed.map((item) => (
                  <ProcessingRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
