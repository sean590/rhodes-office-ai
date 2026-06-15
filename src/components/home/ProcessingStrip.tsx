"use client";

/**
 * ProcessingStrip — a thin Home banner that surfaces in-flight documents and
 * links to the Processing surface. Self-contained (own fetch + poll) so it
 * doesn't entangle the Home inbox's data flow. Renders nothing when the
 * pipeline is idle, so a healthy Home stays clean.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";

interface QueueItem { status: string }

export function ProcessingStrip() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/queue?status=queued,extracting,error,password_required&limit=200");
      const data = res.ok ? await res.json() : [];
      setItems(Array.isArray(data) ? data : []);
    } catch {
      /* non-critical strip — stay silent */
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { fetchCounts().finally(() => { timer = setTimeout(tick, 5000); }); };
    tick();
    return () => clearTimeout(timer);
  }, [fetchCounts]);

  const { processing, stuck } = useMemo(() => {
    let processing = 0, stuck = 0;
    for (const i of items) {
      if (i.status === "queued" || i.status === "extracting" || i.status === "password_required") processing++;
      else if (i.status === "error") stuck++;
    }
    return { processing, stuck };
  }, [items]);

  if (processing === 0 && stuck === 0) return null;

  const bits = [
    processing > 0 ? `${processing} processing` : null,
    stuck > 0 ? `${stuck} stuck` : null,
  ].filter(Boolean).join(" · ");

  return (
    <button
      onClick={() => router.push("/processing")}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", marginBottom: 16,
        border: "1px solid var(--line)", borderRadius: "var(--radius)",
        background: "var(--card)", cursor: "pointer", textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <Icon name="refresh" size={15} color={stuck > 0 ? "var(--red)" : "var(--blue)"} style={processing > 0 ? { animation: "spin 1s linear infinite" } : undefined} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{bits}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
        View <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}
