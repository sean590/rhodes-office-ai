"use client";

/**
 * Home — the Action Inbox. Lanes: Needs you (Approve · Review · File),
 * Suggested, Done. Aggregates existing feeds client-side (home/staged,
 * pipeline/queue, compliance/upcoming, provider suggestions, audit).
 *
 * Items are de-duped (a chat upload fires both staged_actions AND review_ready
 * for the same doc — review owns it) and grouped by origin event so a bulk
 * upload reads as "5 documents you added in chat", not 5 loose cards. Single
 * items render as expandable cards (Edit = expand in place, never /chat);
 * groups get Approve-all + a step-through Review sheet. Timestamps go through
 * lib/format-time (date + time, never time alone).
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ProcessingStrip } from "@/components/home/ProcessingStrip";
import { useIsMobile } from "@/hooks/use-mobile";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { InboxCard, GroupCard, GroupChildRow, SectionHead } from "@/components/home/InboxCard";
import { ReviewSheet, type SheetEntry, type SheetOption } from "@/components/home/ReviewSheet";
import { fieldsForAction } from "@/lib/home-action-fields";
import { DOCUMENT_TYPE_LABELS, getStateLabel } from "@/lib/constants";
import { SuggestedSends } from "@/components/entities/SuggestedSends";
import { formatStamp, formatDue } from "@/lib/format-time";
import {
  dedupeStaged, groupReviews, groupStaged, groupMinConfidence,
  type StagedItem, type ReviewItem, type OriginGroup,
} from "@/lib/home-grouping";
import { humanizeActivity, type RawActivity, type ActorKind, type HumanActivity } from "@/lib/activity-humanizer";

interface Obligation { id: string; name: string; next_due_date: string; status: string; jurisdiction?: string | null; entities?: { id: string; name: string } | null; }

// "DE" → "Delaware", "federal" → "Federal". Same-named obligations (e.g.
// "Annual Franchise Tax") recur across states for multi-state LLCs, so the
// jurisdiction is what tells you which filing you're acting on.
function jurisdictionLabel(j?: string | null): string | null {
  if (!j) return null;
  if (j === "federal") return "Federal";
  return getStateLabel(j as Parameters<typeof getStateLabel>[0]);
}

// Done rows sit under day headers (the date anchor), so a time-only stamp is
// not "time alone" — it reads "Today → 11:26am". Needs-you stamps have no
// header anchor and use formatStamp (date + time).
function doneTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, "");
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

// Home stays short: each lane shows its top groups; "View all" drops into a
// focused single-lane view. Per spec §6 this is a safety valve — a healthy
// inbox rarely exceeds the cap.
const LANE_CAP = 5;
// Inside an expanded group, show a few rows then route the rest to the sheet.
const CHILD_CAP = 4;
type FocusLane = "approve" | "review" | "file";

function approveLabel(tool: string): string {
  if (tool === "send_document_to_provider") return "Approve & send";
  if (tool.startsWith("create_")) return "Create";
  return "Approve";
}

const ACTOR_PILL: Record<ActorKind, { icon: IconName; color: string; bg: string }> = {
  you: { icon: "user", color: "var(--green)", bg: "var(--green-50)" },
  rhodes: { icon: "sparkles", color: "var(--blue)", bg: "var(--blue-50)" },
  person: { icon: "user", color: "var(--muted)", bg: "var(--page)" },
};

// Document-type slugs for the inline review form's type picker.
const DOC_TYPE_SLUGS = Object.keys(DOCUMENT_TYPE_LABELS);

function reviewMeta(r: ReviewItem): string {
  const bits = [r.entity_name, r.document_type_label].filter(Boolean);
  return bits.length ? bits.join(" · ") : "ready to review";
}

// Plain-language explanation of why a document is parked for review, instead of
// the raw queue reason code ("agent_deferred", "mismatch", …).
function reviewReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "agent_deferred":
      return "Rhodes couldn't confidently file this on its own. Confirm it as-is, or reassign the entity / reclassify it in chat — either clears it from here.";
    case "mismatch":
      return "The extracted details didn't match what was expected — give it a quick look before filing.";
    case "duplicate_of_sibling":
      return "This looks like a possible duplicate of another document in the same upload.";
    default:
      return reason ? reason.replace(/_/g, " ") : "Ready to review.";
  }
}

// Two-tone detail for a review item's expanded/sheet view: what it is, where
// it'd go, and why it's here.
function ReviewDetail({ r }: { r: ReviewItem }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 600 }}>{r.document_name}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
        {r.entity_name ? `Suggested entity: ${r.entity_name}` : "No entity assigned yet"}
        {r.document_type_label && r.document_type_label !== "Other" ? ` · ${r.document_type_label}` : ""}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{reviewReasonText(r.approval_reason)}</div>
    </div>
  );
}

export default function HomePage() {
  const setPageContext = useSetPageContext();
  const chatPanel = useChatPanel();
  const router = useRouter();
  const isMobile = useIsMobile();
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
  const [groupBusy, setGroupBusy] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<{ lane: "approve" | "review"; key: string; title: string; index: number } | null>(null);
  const [focus, setFocus] = useState<FocusLane | null>(null);
  const [entityOptions, setEntityOptions] = useState<SheetOption[]>([]);
  const [investmentOptions, setInvestmentOptions] = useState<SheetOption[]>([]);
  const [documentOptions, setDocumentOptions] = useState<SheetOption[]>([]);

  // Reference data for the edit form — resolves *_id refs to human names (never
  // a raw UUID) and powers the entity/investment dropdowns. Fetched once.
  useEffect(() => {
    (async () => {
      try {
        const [eRes, iRes, dRes] = await Promise.all([
          fetch("/api/entities?limit=500"),
          fetch("/api/investments"),
          fetch("/api/documents?limit=500"),
        ]);
        if (eRes.ok) {
          const d = await eRes.json();
          setEntityOptions((Array.isArray(d) ? d : d.entities ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
        if (iRes.ok) {
          const d = await iRes.json();
          setInvestmentOptions((Array.isArray(d) ? d : d.investments ?? []).map((i: { id: string; name: string }) => ({ id: i.id, name: i.name })));
        }
        if (dRes.ok) {
          const d = await dRes.json();
          setDocumentOptions((Array.isArray(d) ? d : d.documents ?? []).map((doc: { id: string; name: string }) => ({ id: doc.id, name: doc.name })));
        }
      } catch { /* non-fatal — refs fall back to a neutral placeholder, never a UUID */ }
    })();
  }, []);

  useEffect(() => { setPageContext({ page: "home" }); }, [setPageContext]);

  const fetchAll = useCallback(async () => {
    try {
      const [meRes, sRes, qRes, cRes, aRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/home/staged"),
        fetch("/api/pipeline/queue?status=review_ready&limit=100"),
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
  // Persist a staged action's terminal status onto the chat message so it
  // doesn't reappear on refetch (the GET filters applied_statuses). The PATCH
  // deep-merges this key, so a single-action delta is safe.
  const persistStatus = useCallback((s: StagedItem, status: "applied" | "rejected") =>
    fetch(`/api/chat/sessions/${s.session_id}/messages/${s.message_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata_merge: { applied_statuses: { [s.id]: status } } }),
    }).catch(() => {/* non-fatal */}), []);

  const approveStagedWith = useCallback(async (s: StagedItem, editedInput?: Record<string, unknown>) => {
    setBusyFor(s.id, true);
    try {
      const res = await fetch("/api/chat/apply-actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: s.session_id, actions: [{ id: s.id, tool: s.tool, input: editedInput ?? s.input, summary: s.summary }] }),
      });
      if (res.ok) { await persistStatus(s, "applied"); setStaged((p) => p.filter((x) => x.id !== s.id)); fetchAll(); }
      else alert("Failed to apply");
    } catch { alert("Failed to apply"); } finally { setBusyFor(s.id, false); }
  }, [fetchAll, persistStatus]);
  const approveStaged = useCallback((s: StagedItem) => approveStagedWith(s), [approveStagedWith]);

  const dismissStaged = useCallback(async (s: StagedItem) => {
    setBusyFor(s.id, true);
    try { await persistStatus(s, "rejected"); setStaged((p) => p.filter((x) => x.id !== s.id)); }
    finally { setBusyFor(s.id, false); }
  }, [persistStatus]);

  const dismissReview = useCallback(async (r: ReviewItem) => {
    setBusyFor(r.id, true);
    try {
      const res = await fetch(`/api/pipeline/queue/${r.id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (res.ok) { setReviews((p) => p.filter((x) => x.id !== r.id)); fetchAll(); }
      else alert("Failed to dismiss");
    } catch { alert("Failed to dismiss"); } finally { setBusyFor(r.id, false); }
  }, [fetchAll]);

  const confirmReview = useCallback(async (r: ReviewItem) => {
    setBusyFor(r.id, true);
    try {
      const res = await fetch(`/api/pipeline/queue/${r.id}/approve`, { method: "POST" });
      if (res.ok) { setReviews((p) => p.filter((x) => x.id !== r.id)); fetchAll(); }
      else alert("Failed to confirm");
    } catch { alert("Failed to confirm"); } finally { setBusyFor(r.id, false); }
  }, [fetchAll]);

  // Apply inline edits (assign entity / reclassify) from the review sheet via
  // the same validated tool path the agent + staged actions use. The
  // link/update handlers auto-resolve the review_ready item server-side
  // (resolvePendingReviewForDocument), so we just prune it locally. With no
  // changes, falls back to a plain confirm.
  const applyReviewEdits = useCallback(async (r: ReviewItem, edited?: Record<string, unknown>) => {
    if (!r.document_id || !edited) return confirmReview(r);
    const actions: Array<{ id: string; tool: string; input: Record<string, unknown>; summary: string }> = [];
    const newEntity = edited.entity_id ? String(edited.entity_id) : "";
    if (newEntity && newEntity !== (r.entity_id ?? "")) {
      actions.push({ id: `rev-${r.id}-entity`, tool: "link_document_to_entity", input: { document_id: r.document_id, entity_id: newEntity }, summary: `Link "${r.document_name}" to entity` });
    }
    const docUpdate: Record<string, unknown> = {};
    if (edited.document_type && edited.document_type !== (r.document_type ?? "")) docUpdate.document_type = edited.document_type;
    if (edited.year != null && edited.year !== "" && Number(edited.year) !== (r.year ?? null)) docUpdate.year = Number(edited.year);
    if (Object.keys(docUpdate).length > 0) {
      actions.push({ id: `rev-${r.id}-update`, tool: "update_document", input: { document_id: r.document_id, ...docUpdate }, summary: `Update "${r.document_name}"` });
    }
    if (actions.length === 0) return confirmReview(r); // nothing changed
    const sessionId = r.chat_session_id ?? r.batch?.session_id;
    if (!sessionId) { alert("No chat session linked to this item — use Refine in chat instead."); return; }
    setBusyFor(r.id, true);
    try {
      const res = await fetch("/api/chat/apply-actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, actions }),
      });
      if (res.ok) { setReviews((p) => p.filter((x) => x.id !== r.id)); fetchAll(); }
      else alert("Failed to apply changes");
    } catch { alert("Failed to apply changes"); } finally { setBusyFor(r.id, false); }
  }, [confirmReview, fetchAll]);

  const markFiled = useCallback(async (o: Obligation) => {
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
  }, [fetchAll]);

  const approveGroup = useCallback(async (g: OriginGroup) => {
    setGroupBusy((b) => ({ ...b, [g.key]: true }));
    try {
      for (const e of g.entries) {
        if (e.staged) await approveStaged(e.staged);
        else if (e.review) await confirmReview(e.review);
      }
    } finally { setGroupBusy((b) => ({ ...b, [g.key]: false })); }
  }, [approveStaged, confirmReview]);

  const dismissGroup = useCallback(async (g: OriginGroup) => {
    setGroupBusy((b) => ({ ...b, [g.key]: true }));
    try {
      if (g.lane === "approve") {
        // All entries in a staged group share one chat message — one PATCH.
        const first = g.entries[0]?.staged;
        if (first) {
          const statuses = Object.fromEntries(g.entries.map((e) => [e.staged!.id, "rejected"]));
          await fetch(`/api/chat/sessions/${first.session_id}/messages/${first.message_id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata_merge: { applied_statuses: statuses } }),
          }).catch(() => {});
          const ids = new Set(g.entries.map((e) => e.staged!.id));
          setStaged((p) => p.filter((x) => !ids.has(x.id)));
        }
      } else {
        for (const e of g.entries) if (e.review) await dismissReview(e.review);
      }
    } finally { setGroupBusy((b) => ({ ...b, [g.key]: false })); }
  }, [dismissReview]);

  // Refine in chat: open the action's chat session in the always-present drawer
  // (no navigation, no auto-send) — never /chat.
  const refineStaged = useCallback((s: StagedItem) => {
    chatPanel.open(undefined, undefined, s.session_id);
  }, [chatPanel]);

  // Reassigning/refining a review item happens in chat (the pipeline
  // materializes one session per deferred item), never on the old /review page.
  const refineReview = useCallback((r: ReviewItem) => {
    // Load the per-item session the pipeline seeded (falls back to the batch
    // session). Do NOT pass a query: the chat drawer AUTO-SENDS a query when
    // there's no session to load (chat-drawer prefill: query-without-session →
    // auto-send), so a session-less review item would fire an unintended
    // message. Open the session (or just the drawer) and let the user type.
    chatPanel.open(undefined, undefined, r.chat_session_id ?? r.batch?.session_id ?? undefined);
  }, [chatPanel]);

  // ── Derived ─────────────────────────────────────────────────────
  const dedupedStaged = useMemo(() => dedupeStaged(staged, reviews), [staged, reviews]);
  // Approve: source recency (groupStaged already sorts newest-first).
  const approveGroups = useMemo(() => groupStaged(dedupedStaged), [dedupedStaged]);
  // Review: lowest extraction confidence first (the most likely to need a human).
  const reviewGroups = useMemo(
    () => groupReviews(reviews).sort((a, b) => groupMinConfidence(a) - groupMinConfidence(b)),
    [reviews],
  );
  // File: due date, overdue first.
  const obligationsSorted = useMemo(
    () => [...obligations].sort((a, b) => (a.next_due_date < b.next_due_date ? -1 : a.next_due_date > b.next_due_date ? 1 : 0)),
    [obligations],
  );

  // Flag likely duplicates/conflicts inside a group: the same staged summary or
  // document name appearing twice. Second+ occurrence is flagged.
  const dupInfo = useCallback((g: OriginGroup) => {
    const seen = new Map<string, number>();
    const ids = new Set<string>();
    for (const e of g.entries) {
      const key = (e.staged?.summary ?? e.review?.document_name ?? "").toLowerCase().trim();
      if (!key) continue;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) ids.add(e.id);
    }
    return { ids, count: ids.size };
  }, []);

  const overdueCount = obligations.filter((o) => formatDue(o.next_due_date).overdue).length;
  const approveCount = dedupedStaged.length;
  const needsCount = approveCount + reviews.length + obligations.length;

  // "No batch as a UX concept": batch/pipeline plumbing events are internal —
  // keep them out of the user-facing Done feed (they read as jargon).
  const HIDDEN_ACTIONS = useMemo(() => new Set(["create_batch", "approve_batch", "process_batch", "process"]), []);
  const HIDDEN_RESOURCES = useMemo(() => new Set(["batch", "document_batch", "pipeline", "document_queue"]), []);
  const visibleActivity = useMemo(
    () => activity.filter((a) => !HIDDEN_ACTIONS.has(a.action) && !HIDDEN_RESOURCES.has(a.resource_type)),
    [activity, HIDDEN_ACTIONS, HIDDEN_RESOURCES],
  );
  const humanized = useMemo(() => visibleActivity.map((a) => humanizeActivity(a, userId)), [visibleActivity, userId]);
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

  // ── Review sheet entries (live — shrink as items are approved) ───
  const sheetEntries: SheetEntry[] = useMemo(() => {
    if (!sheet) return [];
    const groups = sheet.lane === "approve" ? approveGroups : reviewGroups;
    const g = groups.find((x) => x.key === sheet.key);
    if (!g) return [];
    const dups = dupInfo(g);
    return g.entries.map((e): SheetEntry => {
      if (e.staged) {
        const s = e.staged;
        return {
          id: s.id, title: s.summary,
          subtitle: `from chat · ${formatStamp(s.staged_at)}`,
          fields: fieldsForAction(s.tool, s.input), input: s.input,
          dup: dups.ids.has(s.id) ? "This looks like a duplicate of another staged change." : undefined,
          primaryLabel: "Approve",
          onApprove: (edited) => approveStagedWith(s, edited),
          onDismiss: () => dismissStaged(s),
          onRefineChat: () => refineStaged(s), busy: busy[s.id],
        };
      }
      const r = e.review!;
      return {
        id: r.id, title: r.document_name,
        subtitle: `${g.channel === "chat" ? "from chat" : "to review"} · ${reviewMeta(r)}`,
        // Editable inline: assign the entity / confirm the type without leaving
        // for chat. Empty entity = "No entity assigned yet" — the whole point.
        fields: [
          { key: "entity_id", label: "Entity", type: "entity" },
          { key: "document_type", label: "Document type", type: "enum", enumValues: DOC_TYPE_SLUGS },
          { key: "year", label: "Year", type: "year" },
        ],
        input: { entity_id: r.entity_id ?? "", document_type: r.document_type ?? "", year: r.year ?? "" },
        dup: dups.ids.has(r.id) ? "Possible duplicate of another document in this batch." : undefined,
        primaryLabel: "Confirm",
        onApprove: (edited) => applyReviewEdits(r, edited),
        onDismiss: () => dismissReview(r),
        onRefineChat: () => refineReview(r), busy: busy[r.id],
      };
    });
  }, [sheet, approveGroups, reviewGroups, busy, dupInfo, approveStagedWith, applyReviewEdits, dismissStaged, dismissReview, refineStaged, refineReview]);

  const openSheet = (g: OriginGroup, index = 0) =>
    setSheet({ lane: g.lane, key: g.key, title: g.label, index });

  // Deep-link from the Processing page's "Open to review" (?review=<itemId>):
  // open the matching review group's sheet at that item, then clear the param
  // so closing the sheet doesn't immediately reopen it.
  useEffect(() => {
    // Read from window (not useSearchParams) so /home stays statically
    // prerenderable — useSearchParams forces a CSR-bailout Suspense boundary.
    const reviewId = new URLSearchParams(window.location.search).get("review");
    if (!reviewId) return;
    for (const g of reviewGroups) {
      const idx = g.entries.findIndex((e) => e.review?.id === reviewId);
      if (idx >= 0) {
        setSheet({ lane: g.lane, key: g.key, title: g.label, index: idx });
        router.replace("/home", { scroll: false });
        return;
      }
    }
  }, [reviewGroups, router]);

  // ── Renderers ───────────────────────────────────────────────────
  const renderApprove = (g: OriginGroup) => {
    if (g.entries.length === 1) {
      const s = g.entries[0].staged!;
      return (
        <InboxCard
          key={s.id} icon="sparkles" iconColor="var(--green)"
          title={s.summary} channel="chat" meta={formatStamp(s.staged_at)}
          actions={[{ label: approveLabel(s.tool), variant: "primary", onClick: () => approveStaged(s), busy: busy[s.id] }]}
          expandedContent={
            <div>
              <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.55 }}>{s.summary}</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>Action: {s.tool}</div>
              <div style={{ marginTop: 12 }}>
                <Button variant="secondary" onClick={() => refineStaged(s)}>Refine in chat</Button>
              </div>
            </div>
          }
        />
      );
    }
    const dups = dupInfo(g);
    return (
      <GroupCard
        key={g.key} icon="sparkles" iconColor="var(--green)"
        label={g.label} channel={g.channel} stamp={formatStamp(g.time)} count={g.entries.length} dupCount={dups.count}
        actions={[{ label: "Approve all", variant: "primary", onClick: () => approveGroup(g), busy: groupBusy[g.key] }]}
        onDismissAll={() => dismissGroup(g)} childCap={CHILD_CAP}
      >
        {g.entries.map((e, i) => {
          const s = e.staged!;
          return (
            <GroupChildRow
              key={s.id} title={s.summary} meta={formatStamp(s.staged_at)} dup={dups.ids.has(e.id)}
              actions={[
                { label: approveLabel(s.tool), variant: "primary", onClick: () => approveStaged(s), busy: busy[s.id] },
                { label: "Edit", variant: "secondary", onClick: () => openSheet(g, i) },
              ]}
            />
          );
        })}
      </GroupCard>
    );
  };

  const renderReview = (g: OriginGroup) => {
    if (g.entries.length === 1) {
      const r = g.entries[0].review!;
      return (
        <InboxCard
          key={r.id} icon="file-text" iconColor="var(--blue)"
          title={r.document_name} channel={g.channel} meta={reviewMeta(r)}
          actions={[{ label: "Confirm", variant: "primary", onClick: () => confirmReview(r), busy: busy[r.id] }]}
          expandedContent={
            <div>
              <ReviewDetail r={r} />
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button variant="secondary" onClick={() => refineReview(r)}>Refine in chat</Button>
              </div>
            </div>
          }
        />
      );
    }
    const dups = dupInfo(g);
    return (
      <GroupCard
        key={g.key} icon="file-text" iconColor="var(--blue)"
        label={g.label} channel={g.channel} stamp={formatStamp(g.time)} count={g.entries.length} dupCount={dups.count}
        actions={[{ label: "Confirm all", variant: "primary", onClick: () => approveGroup(g), busy: groupBusy[g.key] }]}
        onDismissAll={() => dismissGroup(g)} childCap={CHILD_CAP}
      >
        {g.entries.map((e, i) => {
          const r = e.review!;
          return (
            <GroupChildRow
              key={r.id} title={r.document_name} meta={reviewMeta(r)} dup={dups.ids.has(e.id)}
              actions={[
                { label: "Confirm", variant: "primary", onClick: () => confirmReview(r), busy: busy[r.id] },
                { label: "Edit", variant: "secondary", onClick: () => openSheet(g, i) },
              ]}
            />
          );
        })}
      </GroupCard>
    );
  };

  const renderObligation = (o: Obligation) => {
    const due = formatDue(o.next_due_date);
    const jl = jurisdictionLabel(o.jurisdiction);
    return (
      <InboxCard
        key={o.id}
        icon="checklist" iconColor="var(--amber)"
        title={jl ? `${o.name} · ${jl}` : o.name}
        channel="compliance"
        meta={o.entities?.name ?? "Filing"}
        badge={{ text: due.text, color: due.overdue ? "var(--red)" : "var(--amber)" }}
        actions={[
          { label: "Mark filed", variant: "primary", onClick: () => markFiled(o), busy: busy[o.id], disabled: !o.entities },
          ...(o.entities ? [{ label: "Open", href: `/entities/${o.entities.id}?tab=compliance` }] : []),
        ]}
      />
    );
  };

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>Home</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 18px" }}>Everything waiting on you — one queue, no matter where it came from.</p>

      <ProcessingStrip />

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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10, marginBottom: 4 }}>
            <Stat n={needsCount} label="All needs-you" onClick={() => setFocus(null)} active={focus === null} />
            <Stat n={approveCount} label="To approve" onClick={approveCount ? () => setFocus("approve") : undefined} active={focus === "approve"} />
            <Stat n={reviews.length} label="To review" onClick={reviews.length ? () => setFocus("review") : undefined} active={focus === "review"} />
            <Stat n={overdueCount} label="Filings overdue" red onClick={obligations.length ? () => setFocus("file") : undefined} active={focus === "file"} />
          </div>

          {focus && (
            <button
              onClick={() => setFocus(null)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "16px 2px 2px", fontSize: 13, fontWeight: 600, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              <Icon name="arrow-left" size={15} /> Back to all
            </button>
          )}

          {!loading && needsCount === 0 && <Empty icon="circle-check" text="You’re all caught up." />}

          {(focus === null || focus === "approve") && approveGroups.length > 0 && (
            <div>
              <SectionHead label="Approve · the agent staged these" count={approveCount} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(focus === "approve" ? approveGroups : approveGroups.slice(0, LANE_CAP)).map(renderApprove)}
              </div>
              {focus === null && approveGroups.length > LANE_CAP && <ViewAll n={approveGroups.length} onClick={() => setFocus("approve")} />}
            </div>
          )}

          {(focus === null || focus === "review") && reviewGroups.length > 0 && (
            <div>
              <SectionHead label="Review · confirm what Rhodes extracted" count={reviews.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(focus === "review" ? reviewGroups : reviewGroups.slice(0, LANE_CAP)).map(renderReview)}
              </div>
              {focus === null && reviewGroups.length > LANE_CAP && <ViewAll n={reviewGroups.length} onClick={() => setFocus("review")} />}
            </div>
          )}

          {(focus === null || focus === "file") && obligationsSorted.length > 0 && (
            <div>
              <SectionHead label="File · compliance deadlines" count={obligations.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(focus === "file" ? obligationsSorted : obligationsSorted.slice(0, LANE_CAP)).map(renderObligation)}
              </div>
              {focus === null && obligationsSorted.length > LANE_CAP && <ViewAll n={obligationsSorted.length} onClick={() => setFocus("file")} />}
            </div>
          )}
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
                      <span style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)", minWidth: 58, textAlign: "right" }}>{doneTime(h.created_at)}</span>
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

      <ReviewSheet
        key={sheet ? `${sheet.key}-${sheet.index}` : "closed"}
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title ?? ""}
        entries={sheetEntries}
        initialIndex={sheet?.index ?? 0}
        entityOptions={entityOptions}
        investmentOptions={investmentOptions}
        documentOptions={documentOptions}
      />
    </div>
  );
}

function Stat({ n, label, red, onClick, active }: { n: number; label: string; red?: boolean; onClick?: () => void; active?: boolean }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      style={{
        border: `1px solid ${active ? "var(--green)" : "var(--line)"}`, borderRadius: "var(--radius)",
        background: active ? "var(--green-50)" : "var(--card)", padding: "13px 15px",
        cursor: clickable ? "pointer" : "default", textAlign: "left",
        transition: "border-color .12s, background .12s",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: red && n > 0 ? "var(--red)" : "var(--ink)" }}>{n}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
        {label}{clickable && n > 0 && <Icon name="chevron-right" size={13} />}
      </div>
    </div>
  );
}

function ViewAll({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 10, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, fontWeight: 600, color: "var(--green)", background: "none", border: "none",
        cursor: "pointer", fontFamily: "inherit", padding: "2px 0",
      }}
    >
      View all {n} <Icon name="arrow-right" size={14} />
    </button>
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
