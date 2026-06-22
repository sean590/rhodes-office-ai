/**
 * home-grouping — turns the two raw Action-Inbox feeds (chat staged_actions,
 * pipeline review_ready) into origin-grouped lanes, and de-dups the overlap.
 *
 * Why this exists (verified against the ingestion code):
 *  - A chat upload fires BOTH paths for the same docs: the orchestrator stages
 *    write actions on the chat message, AND the pipeline worker may defer the
 *    doc to review_ready. "One piece of work, one lane" (spec §6) requires a
 *    de-dup. The reliable join key is `document_id` — review items carry it on
 *    the queue row; filing-type staged actions carry it in their tool `input`.
 *  - Rule: a staged action is dropped from Approve ONLY when its single
 *    document_id matches a review item (review owns it). Staged actions with no
 *    document_id (metadata edits, links, instructions) or multiple docs are
 *    kept — never hide work we can't positively prove is a duplicate.
 *
 * Grouping (spec §5): a bulk upload stages dozens of items; flat rendering
 * floods the queue. Items are grouped by their origin event — review items by
 * `batch_id`, staged actions by the assistant `message_id` that staged them —
 * and labelled with a human phrase, never "batch #N".
 */

export interface StagedItem {
  session_id: string;
  message_id: string;
  id: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  staged_at: string;
}

export interface ReviewItem {
  id: string;
  document_name: string;
  document_type?: string | null;
  document_type_label?: string | null;
  entity_name: string | null;
  entity_id?: string | null;
  year?: number | null;
  approval_reason: string | null;
  document_id: string | null;
  chat_session_id?: string | null;
  ai_confidence: number | null;
  batch_id: string;
  created_at: string;
  batch: {
    context: string;
    name: string | null;
    created_at: string;
    session_id: string | null;
  } | null;
}

export type Channel = "chat" | "email" | "compliance" | "upload" | "portal";

export interface InboxEntry {
  lane: "approve" | "review";
  id: string;
  review?: ReviewItem;
  staged?: StagedItem;
}

export interface OriginGroup {
  /** batch_id (review) or message_id (approve). */
  key: string;
  lane: "approve" | "review";
  channel: Channel;
  /** Human group label, e.g. "5 documents you added in chat". Singletons use the item's own title. */
  label: string;
  /** Most recent time in the group, for the stamp + sort. */
  time: string;
  entries: InboxEntry[];
}

/** Pull every document_id a staged action references, from common input shapes. */
export function stagedDocIds(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const single = input.document_id;
  if (typeof single === "string" && single) out.push(single);
  const many = input.document_ids;
  if (Array.isArray(many)) for (const x of many) if (typeof x === "string" && x) out.push(x);
  return out;
}

/**
 * Drop staged actions whose work a review item already owns. Conservative:
 * only a single-document staged action whose doc_id is in review is dropped.
 */
export function dedupeStaged(staged: StagedItem[], reviews: ReviewItem[]): StagedItem[] {
  const reviewDocIds = new Set(reviews.map((r) => r.document_id).filter((x): x is string => !!x));
  if (reviewDocIds.size === 0) return staged;
  return staged.filter((s) => {
    const ids = stagedDocIds(s.input);
    if (ids.length === 1) return !reviewDocIds.has(ids[0]);
    return true; // no doc, or multi-doc → keep (can't prove a duplicate)
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function reviewOrigin(context: string): { channel: Channel; verb: string } {
  switch (context) {
    case "chat":
      return { channel: "chat", verb: "you added in chat" };
    case "email":
    case "inbound":
    case "inbound_email":
      return { channel: "email", verb: "from email" };
    case "portal":
    case "portal_pull":
      return { channel: "portal", verb: "pulled from a portal" };
    default:
      return { channel: "upload", verb: "you uploaded" };
  }
}

/** Group review_ready items by their source batch (the origin event). */
export function groupReviews(reviews: ReviewItem[]): OriginGroup[] {
  const byBatch = new Map<string, ReviewItem[]>();
  for (const r of reviews) {
    const k = r.batch_id || r.id;
    const arr = byBatch.get(k);
    if (arr) arr.push(r);
    else byBatch.set(k, [r]);
  }
  const groups: OriginGroup[] = [];
  for (const [key, items] of byBatch) {
    const { channel, verb } = reviewOrigin(items[0].batch?.context ?? "upload");
    const time = items.reduce((t, i) => (i.created_at > t ? i.created_at : t), items[0].created_at);
    groups.push({
      key,
      lane: "review",
      channel,
      label: `${plural(items.length, "document")} ${verb}`,
      time,
      entries: items.map((r) => ({ lane: "review" as const, id: r.id, review: r })),
    });
  }
  return groups.sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** Lowest extraction confidence in a review group (for "Review by lowest confidence" sort). */
export function groupMinConfidence(g: OriginGroup): number {
  let min = Infinity;
  for (const e of g.entries) {
    const c = e.review?.ai_confidence;
    if (typeof c === "number" && c < min) min = c;
  }
  return min === Infinity ? 1 : min;
}

/** Group staged chat actions by the assistant turn (message) that staged them. */
export function groupStaged(staged: StagedItem[]): OriginGroup[] {
  const byMsg = new Map<string, StagedItem[]>();
  for (const s of staged) {
    const arr = byMsg.get(s.message_id);
    if (arr) arr.push(s);
    else byMsg.set(s.message_id, [s]);
  }
  const groups: OriginGroup[] = [];
  for (const [key, items] of byMsg) {
    const time = items.reduce((t, i) => (i.staged_at > t ? i.staged_at : t), items[0].staged_at);
    groups.push({
      key,
      lane: "approve",
      channel: "chat",
      label: `${plural(items.length, "change")} Rhodes staged from chat`,
      time,
      entries: items.map((s) => ({ lane: "approve" as const, id: s.id, staged: s })),
    });
  }
  return groups.sort((a, b) => (a.time < b.time ? 1 : -1));
}
