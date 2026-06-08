"use client";

/**
 * Home — the Action Inbox. Three lanes via SegmentedControl:
 *   • Needs you — pending document reviews + due/overdue filings
 *   • Suggested — proactive opportunities Rhodes spots (send suggestions today;
 *                 inbound feeds this in a later phase)
 *   • Done      — humanized recent activity, filterable by actor
 * Aggregates existing endpoints client-side (no new API): /pipeline/queue,
 * /compliance/upcoming, /provider-sends/suggestions, /audit.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { SuggestedSends } from "@/components/entities/SuggestedSends";
import { humanizeActivity, type RawActivity, type ActorKind } from "@/lib/activity-humanizer";

interface ReviewItem {
  id: string;
  original_filename?: string;
  ai_suggested_name?: string | null;
  entity_name?: string | null;
  ai_summary?: string | null;
  approval_reason?: string | null;
}
interface Obligation {
  id: string;
  name: string;
  next_due_date: string;
  status: string;
  entities?: { id: string; name: string } | null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtDue(iso: string): { text: string; overdue: boolean } {
  const due = new Date(iso + "T00:00:00Z").getTime();
  const days = Math.round((due - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, overdue: true };
  if (days === 0) return { text: "due today", overdue: true };
  return { text: `due in ${days}d`, overdue: false };
}

function InboxRow({
  icon, iconColor, title, subtitle, href, action, badge,
}: {
  icon: IconName; iconColor: string; title: string; subtitle: React.ReactNode;
  href: string; action: string; badge?: { text: string; color: string };
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)" }}>
      <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--page)", color: iconColor }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{subtitle}</div>
      </div>
      {badge && (
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, color: badge.color, background: "var(--page)" }}>{badge.text}</span>
      )}
      <Link href={href} style={{ flexShrink: 0, textDecoration: "none" }}>
        <Button variant="primary">{action}</Button>
      </Link>
    </div>
  );
}

const ACTOR_DOT: Record<ActorKind, string> = { you: "var(--green)", person: "var(--blue)", rhodes: "var(--purple)" };

export default function HomePage() {
  const setPageContext = useSetPageContext();
  const [lane, setLane] = useState<"needs" | "suggested" | "done">("needs");
  const [userId, setUserId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [activity, setActivity] = useState<RawActivity[]>([]);
  const [suggestedCount, setSuggestedCount] = useState(0);
  const [doneActor, setDoneActor] = useState<"all" | "you" | "rhodes">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPageContext({ page: "home" }); }, [setPageContext]);

  const fetchAll = useCallback(async () => {
    try {
      const [meRes, qRes, cRes, aRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/pipeline/queue?status=review_ready&limit=50"),
        fetch("/api/compliance/upcoming"),
        fetch("/api/audit?limit=40").catch(() => null),
      ]);
      if (meRes.ok) setUserId((await meRes.json())?.id ?? null);
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

  const needsCount = reviews.length + obligations.length;

  const humanized = useMemo(() => activity.map((a) => humanizeActivity(a, userId)), [activity, userId]);
  const doneShown = useMemo(
    () => humanized.filter((h) => doneActor === "all" || h.actor === doneActor || (doneActor === "you" && h.actor === "you")),
    [humanized, doneActor],
  );

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>Home</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 18px" }}>What needs you, what Rhodes suggests, and what’s been done.</p>

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
        {!loading && suggestedCount === 0 && (
          <Empty icon="sparkles" text="Nothing suggested right now. Rhodes surfaces sends here as documents come in." />
        )}
      </div>

      {lane === "needs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!loading && needsCount === 0 && <Empty icon="circle-check" text="You’re all caught up." />}
          {reviews.map((r) => (
            <InboxRow
              key={r.id}
              icon="file-text" iconColor="var(--blue)"
              title={r.ai_suggested_name || r.original_filename || "Document"}
              subtitle={r.entity_name ? `${r.entity_name} · Ready to review` : "Ready to review"}
              href="/review" action="Review"
            />
          ))}
          {obligations.map((o) => {
            const due = fmtDue(o.next_due_date);
            return (
              <InboxRow
                key={o.id}
                icon="checklist" iconColor="var(--amber)"
                title={o.name}
                subtitle={o.entities?.name ?? "Filing"}
                href={o.entities ? `/entities/${o.entities.id}?tab=compliance` : "/compliance"}
                action="Open"
                badge={{ text: due.text, color: due.overdue ? "var(--red)" : "var(--amber)" }}
              />
            );
          })}
        </div>
      )}

      {lane === "done" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {(["all", "you", "rhodes"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setDoneActor(a)}
                style={{
                  fontSize: 12.5, padding: "5px 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${doneActor === a ? "var(--green)" : "var(--line-2)"}`,
                  background: doneActor === a ? "var(--green-50)" : "var(--card)",
                  color: doneActor === a ? "var(--green)" : "var(--muted)", fontWeight: doneActor === a ? 600 : 500,
                  textTransform: "capitalize",
                }}
              >
                {a === "rhodes" ? "Rhodes" : a}
              </button>
            ))}
          </div>
          {!loading && doneShown.length === 0 && <Empty icon="clock" text="No recent activity to show." />}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {doneShown.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 4px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flexShrink: 0, color: h.color }}><Icon name={h.icon} size={17} /></div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" }}>{h.text}</div>
                <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: ACTOR_DOT[h.actor] }} />
                  {h.actorName}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)", minWidth: 56, textAlign: "right" }}>{relTime(h.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
