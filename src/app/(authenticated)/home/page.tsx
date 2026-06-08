"use client";

/**
 * Home — the Action Inbox. Lanes: Needs you (Approve · Review · File), Suggested,
 * Done. Aggregates existing endpoints client-side (home/staged, pipeline/queue,
 * compliance/upcoming, provider-sends/suggestions, audit). Inline actions:
 * Approve & send (chat apply-actions), Confirm (queue approve), Mark filed
 * (compliance complete). Snooze + the branching decision card are follow-ons.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Icon, type IconName } from "@/components/ui/icon";
import { InboxCard, SectionHead } from "@/components/home/InboxCard";
import { SuggestedSends } from "@/components/entities/SuggestedSends";
import { humanizeActivity, type RawActivity, type ActorKind, type HumanActivity } from "@/lib/activity-humanizer";

interface StagedItem { session_id: string; message_id: string; id: string; tool: string; input: Record<string, unknown>; summary: string; staged_at: string; }
interface ReviewItem { id: string; original_filename?: string; ai_suggested_name?: string | null; entity_name?: string | null; approval_reason?: string | null; }
interface Obligation { id: string; name: string; next_due_date: string; status: string; entities?: { id: string; name: string } | null; }

function fmtTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
}
function dayLabel(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const td = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((td.getTime() - dd.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
function fmtDue(iso: string): { text: string; overdue: boolean } {
  const days = Math.round((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, overdue: true };
  if (days === 0) return { text: "due today", overdue: true };
  return { text: `due in ${days}d`, overdue: false };
}

function approveLabel(tool: string): string {
  if (tool === "send_document_to_provider") return "Approve & send";
  if (tool.startsWith("create_")) return "Create";
  if (tool.startsWith("delete_") || tool.startsWith("archive_") || tool === "revoke_provider_send") return "Approve";
  return "Approve";
}

const ACTOR_PILL: Record<ActorKind, { icon: IconName; color: string; bg: string }> = {
  you: { icon: "user", color: "var(--green)", bg: "var(--green-50)" },
  rhodes: { icon: "sparkles", color: "var(--blue)", bg: "var(--blue-50)" },
  person: { icon: "user", color: "var(--muted)", bg: "var(--page)" },
};

export default function HomePage() {
  const setPageContext = useSetPageContext();
  const [lane, setLane] = useState<"needs" | "suggested" | "done">("needs");
  const [userId, setUserId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [activity, setActivity] = useState<RawActivity[]>([]);
  const [suggestedCount, setSuggestedCount] = useState(0);
  const [doneActor, setDoneActor] = useState<"all" | "you" | "rhodes">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => { setPageContext({ page: "home" }); }, [setPageContext]);

  const fetchAll = useCallback(async () => {
    try {
      const [meRes, sRes, qRes, cRes, aRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/home/staged"),
        fetch("/api/pipeline/queue?status=review_ready&limit=50"),
        fetch("/api/compliance/upcoming"),
        fetch("/api/audit?limit=60").catch(() => null),
      ]);
      if (meRes.ok) setUserId((await meRes.json())?.id ?? null);
      if (sRes.ok) setStaged(await sRes.json());
      if (qRes.ok) { const d = await qRes.json(); setReviews(Array.isArray(d) ? d : d.items ?? []); }
      if (cRes.ok) setObligations((await cRes.json())?.obligations ?? []);
      if (aRes && aRes.ok) setActivity(await aRes.json());
    } catch (err) {
      console.error("Home load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const setBusyFor = (k: string, v: boolean) => setBusy((b) => ({ ...b, [k]: v }));

  // ── Inline actions ──────────────────────────────────────────────
  const approveStaged = async (s: StagedItem) => {
    setBusyFor(s.id, true);
    try {
      const res = await fetch("/api/chat/apply-actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: s.session_id, actions: [{ id: s.id, tool: s.tool, input: s.input, summary: s.summary }] }),
      });
      if (res.ok) { setStaged((p) => p.filter((x) => x.id !== s.id)); fetchAll(); }
      else alert("Failed to apply");
    } catch { alert("Failed to apply"); } finally { setBusyFor(s.id, false); }
  };
  const confirmReview = async (r: ReviewItem) => {
    setBusyFor(r.id, true);
    try {
      const res = await fetch(`/api/pipeline/queue/${r.id}/approve`, { method: "POST" });
      if (res.ok) { setReviews((p) => p.filter((x) => x.id !== r.id)); fetchAll(); }
      else alert("Failed to confirm");
    } catch { alert("Failed to confirm"); } finally { setBusyFor(r.id, false); }
  };
  const markFiled = async (o: Obligation) => {
    if (!o.entities) return;
    setBusyFor(o.id, true);
    try {
      const res = await fetch(`/api/entities/${o.entities.id}/compliance/${o.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (res.ok) { setObligations((p) => p.filter((x) => x.id !== o.id)); fetchAll(); }
      else alert("Failed to mark filed");
    } catch { alert("Failed to mark filed"); } finally { setBusyFor(o.id, false); }
  };

  // ── Derived ─────────────────────────────────────────────────────
  const overdueCount = obligations.filter((o) => fmtDue(o.next_due_date).overdue).length;
  const needsCount = staged.length + reviews.length + obligations.length;

  const humanized = useMemo(() => activity.map((a) => humanizeActivity(a, userId)), [activity, userId]);
  const doneShown = useMemo(() => humanized.filter((h) => doneActor === "all" || h.actor === doneActor), [humanized, doneActor]);
  const doneByDay = useMemo(() => {
    const groups: { label: string; items: HumanActivity[] }[] = [];
    for (const h of doneShown) {
      const label = dayLabel(h.created_at);
      const g = groups.find((x) => x.label === label);
      if (g) g.items.push(h); else groups.push({ label, items: [h] });
    }
    return groups;
  }, [doneShown]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>Home</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 18px" }}>Everything waiting on you — one queue, no matter where it came from.</p>

      <div style={{ marginBottom: 18 }}>
        <SegmentedControl
          value={lane}
          onChange={(v) => setLane(v as typeof lane)}
          options={[
            { value: "needs", label: "Needs you", count: needsCount },
            { value: "suggested", label: "Suggested", count: suggestedCount },
            { value: "done", label: "Done" },
          ]}
        />
      </div>

      {/* Keep Suggested mounted (hidden) so its count populates the tab badge. */}
      <div style={{ display: lane === "suggested" ? "block" : "none" }}>
        <SuggestedSends bare onCount={setSuggestedCount} onSent={fetchAll} />
        {!loading && suggestedCount === 0 && <Empty icon="sparkles" text="Nothing suggested right now. Rhodes surfaces sends here as documents come in." />}
      </div>

      {lane === "needs" && (
        <div>
          {/* Stat strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 4 }}>
            <Stat n={needsCount} label="All needs-you" />
            <Stat n={staged.length} label="To approve" />
            <Stat n={reviews.length} label="To review" />
            <Stat n={overdueCount} label="Filings overdue" red />
          </div>

          {!loading && needsCount === 0 && <Empty icon="circle-check" text="You’re all caught up." />}

          {staged.length > 0 && <SectionHead label="Approve · the agent staged these" count={staged.length} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {staged.map((s) => (
              <InboxCard
                key={s.id}
                icon="sparkles" iconColor="var(--green)"
                title={s.summary}
                channel="chat"
                meta={`staged ${fmtTime(s.staged_at)}`}
                actions={[
                  { label: approveLabel(s.tool), variant: "primary", onClick: () => approveStaged(s), busy: busy[s.id] },
                  { label: "Edit", href: "/chat" },
                ]}
              />
            ))}
          </div>

          {reviews.length > 0 && <SectionHead label="Review · confirm what Rhodes extracted" count={reviews.length} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {reviews.map((r) => (
              <InboxCard
                key={r.id}
                icon="file-text" iconColor="var(--blue)"
                title={r.ai_suggested_name || r.original_filename || "Document"}
                meta={r.entity_name ? `${r.entity_name} · ready to review` : "ready to review"}
                actions={[
                  { label: "Confirm", variant: "primary", onClick: () => confirmReview(r), busy: busy[r.id] },
                  { label: "Reassign", href: "/review" },
                ]}
              />
            ))}
          </div>

          {obligations.length > 0 && <SectionHead label="File · compliance deadlines" count={obligations.length} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {obligations.map((o) => {
              const due = fmtDue(o.next_due_date);
              return (
                <InboxCard
                  key={o.id}
                  icon="checklist" iconColor="var(--amber)"
                  title={o.name}
                  channel="compliance"
                  meta={o.entities?.name ?? "Filing"}
                  badge={{ text: due.text, color: due.overdue ? "var(--red)" : "var(--amber)" }}
                  actions={[
                    { label: "Mark filed", variant: "primary", onClick: () => markFiled(o), busy: busy[o.id], disabled: !o.entities },
                    ...(o.entities ? [{ label: "Open", href: `/entities/${o.entities.id}?tab=compliance` }] : []),
                  ]}
                />
              );
            })}
          </div>
        </div>
      )}

      {lane === "done" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {(["all", "you", "rhodes"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setDoneActor(a)}
                style={{
                  fontSize: 12.5, padding: "5px 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
                  border: `1px solid ${doneActor === a ? "var(--green)" : "var(--line-2)"}`,
                  background: doneActor === a ? "var(--green-50)" : "var(--card)",
                  color: doneActor === a ? "var(--green)" : "var(--muted)", fontWeight: doneActor === a ? 600 : 500,
                }}
              >
                {a === "rhodes" ? "Rhodes" : a}
              </button>
            ))}
          </div>
          {!loading && doneShown.length === 0 && <Empty icon="clock" text="No recent activity to show." />}
          {doneByDay.map((group) => (
            <div key={group.label} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--faint)", margin: "0 2px 6px" }}>{group.label}</div>
              <div>
                {group.items.map((h) => {
                  const pill = ACTOR_PILL[h.actor];
                  return (
                    <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--page)", color: h.color }}>
                        <Icon name={h.icon} size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.lead}{h.detail && <span style={{ color: "var(--muted)" }}> {h.detail}</span>}
                      </div>
                      <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 999, color: pill.color, background: pill.bg }}>
                        <Icon name={pill.icon} size={13} /> {h.actorName}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)", minWidth: 58, textAlign: "right" }}>{fmtTime(h.created_at)}</span>
                      <span style={{ flexShrink: 0, width: 44, textAlign: "right" }}>
                        {h.viewHref ? (
                          <a href={h.viewHref} style={{ fontSize: 12.5, color: "var(--muted)", textDecoration: "none" }}>View</a>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, red }: { n: number; label: string; red?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "13px 15px" }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: red && n > 0 ? "var(--red)" : "var(--ink)" }}>{n}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 0", color: "var(--faint)" }}>
      <Icon name={icon} size={28} stroke={1.5} />
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  );
}
