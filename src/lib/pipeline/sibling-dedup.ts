/**
 * Sibling-action deduplication for split children.
 *
 * Background: a single multi-investor PDF (e.g., a fund's distribution
 * package) gets split into per-investor children. Each child re-extracts
 * independently, and two siblings can end up proposing the same database
 * mutation — e.g., section A and section B both produce
 * `record_investment_transaction` for "Emma / $96,086.69 / 2022-08-19"
 * because section B was misattributed (its actual page is John Patrick's,
 * but the model picked Emma from the candidate roster). Without dedup,
 * approving every card produces duplicate transactions in the ledger.
 *
 * This module runs after every child finishes extracting, walks all
 * children of the same parent, groups overlapping proposals, and drops the
 * duplicates from each child's ai_proposed_actions. Pass is idempotent —
 * if a later sibling re-runs the pass after another sibling extracts, the
 * grouping just regenerates from the current state.
 *
 * Replaces the dedup that lived inside processCompositeV2 before the
 * pipeline unification. The old version only collapsed
 * update_investment_transaction collisions (where a shared transaction_id
 * makes dedup trivial). This version also collapses
 * record_investment_transaction duplicates by matching on
 * (investment_id, investor_id_or_name, type, date~1d, amount~1%).
 */

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

type Action = {
  action: string;
  data?: Record<string, unknown>;
  reason?: string;
  confidence?: string;
};

interface ChildRow {
  id: string;
  created_at: string;
  ai_proposed_actions: Action[] | null;
}

/** Normalized key identifying "the same economic event."
 *  - investor_key prefers investment_investor_id (exact uuid match) and
 *    falls back to a lowercase / whitespace-collapsed investor_name when
 *    the action didn't supply an id. This is how we collapse Sibling A's
 *    "Emma Doherty" against Sibling B's "Emma A. Doherty".
 *  - amount and date are bucketed (1% / 1-day) so model rounding or
 *    one-day mis-reads don't escape dedup. */
type DedupKey = string;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/** Bucket amount to nearest 1% so $96,086.69 and $96,083.50 collapse. */
function amountBucket(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Bucket date to its day. Action dates are already YYYY-MM-DD strings, but
 *  guard against a stray ISO-with-time. */
function dateBucket(date: string): string {
  return (date || "").slice(0, 10);
}

function dedupKeyFor(a: Action): DedupKey | null {
  if (a.action !== "record_investment_transaction" && a.action !== "update_investment_transaction") {
    return null;
  }
  const data = a.data || {};

  // Bare-update path: the prompt instructs the model to emit
  // `update_investment_transaction { transaction_id: X }` (no other fields)
  // when it matches an existing ledger row. With the ledger-key path below,
  // bare updates would have empty investment/investor/amount/date — every
  // bare update across siblings would collide on the same degenerate key
  // and only one would survive (Distribution #3: Sean's bare update kept,
  // John Patrick's bare update for a DIFFERENT txn demoted as a "duplicate").
  // For bare updates, the only true duplicate signal is the txn_id itself.
  const hasLedgerData =
    "amount" in data ||
    "transaction_date" in data ||
    "investor_name" in data ||
    "investment_investor_id" in data;
  if (a.action === "update_investment_transaction" && !hasLedgerData) {
    const txnId = (data.transaction_id as string) || "";
    if (!txnId) return null; // nothing useful to match on; skip dedup
    return `txn:${txnId}`;
  }

  // Ledger-key path: economic-event signature used for record_*, and for
  // update_* that carries a full correction (different amount, etc.).
  // Two siblings proposing the same (investor, type, date, amount) on the
  // same investment are duplicates regardless of action type.
  const investmentId = (data.investment_id as string) || "";
  const investorId = (data.investment_investor_id as string) || "";
  const investorName = normalizeName((data.investor_name as string) || "");
  const txType = (data.transaction_type as string) || "";
  const date = dateBucket((data.transaction_date as string) || "");
  const amount = amountBucket((data.amount as number) ?? 0);

  // Need at least an investor signal AND an amount to call something a
  // duplicate. Without that, false positives are too easy (e.g., two empty
  // record_* actions look identical but might be different events).
  if ((!investorId && !investorName) || !amount) return null;

  const investorKey = investorId || investorName;
  return `ledger:${investmentId}|${investorKey}|${txType}|${date}|${amount}`;
}

/** Among a group of duplicate actions across siblings, choose the one we
 *  keep. Preferences:
 *  1. update_investment_transaction beats record_investment_transaction —
 *     the update branch fires when the model already matched an existing
 *     ledger row, which is strictly better than creating a new one.
 *  2. Within the same action type, the earliest-created child wins —
 *     deterministic and matches "first sibling to extract sets the
 *     anchor." */
function pickKeeper(
  candidates: Array<{ child: ChildRow; actionIndex: number; action: Action }>,
): { child: ChildRow; actionIndex: number; action: Action } {
  const updates = candidates.filter((c) => c.action.action === "update_investment_transaction");
  const pool = updates.length > 0 ? updates : candidates;
  return [...pool].sort((a, b) =>
    a.child.created_at.localeCompare(b.child.created_at),
  )[0];
}

/**
 * Run the dedup pass for one parent's children. Idempotent — safe to call
 * after every child finishes extracting; the last call (after the last
 * child's actions land) is the authoritative one.
 */
export async function dedupSiblingProposals(
  admin: Admin,
  parentQueueId: string,
): Promise<{ scanned: number; demoted: number }> {
  const { data: rows, error } = await admin
    .from("document_queue")
    .select("id, created_at, ai_proposed_actions")
    .eq("parent_queue_id", parentQueueId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error(
      `[SIBLING-DEDUP] ${parentQueueId}: failed to load children: ${error.message}`,
    );
    return { scanned: 0, demoted: 0 };
  }

  const children = (rows || []) as ChildRow[];
  // Flatten to {child, actionIndex, action, dedupKey} so we can group across
  // siblings and still know where to write the demotion back.
  type FlatEntry = {
    child: ChildRow;
    actionIndex: number;
    action: Action;
    key: DedupKey;
  };
  const flat: FlatEntry[] = [];
  for (const child of children) {
    const actions = Array.isArray(child.ai_proposed_actions)
      ? child.ai_proposed_actions
      : [];
    for (let i = 0; i < actions.length; i++) {
      const key = dedupKeyFor(actions[i]);
      if (key) flat.push({ child, actionIndex: i, action: actions[i], key });
    }
  }

  const groups = new Map<DedupKey, FlatEntry[]>();
  for (const e of flat) {
    if (!groups.has(e.key)) groups.set(e.key, []);
    groups.get(e.key)!.push(e);
  }

  // Per-child set of action indices to demote. Demotion = remove the action
  // from the proposed_actions array entirely. Keepers stay as-is.
  const toDemote = new Map<string, Set<number>>();
  let demotedCount = 0;
  for (const [, entries] of groups) {
    if (entries.length <= 1) continue; // No collision.
    const keeper = pickKeeper(entries);
    for (const e of entries) {
      if (e === keeper) continue;
      if (!toDemote.has(e.child.id)) toDemote.set(e.child.id, new Set());
      toDemote.get(e.child.id)!.add(e.actionIndex);
      demotedCount++;
      console.log(
        `[SIBLING-DEDUP] ${parentQueueId}: demoting ${e.action.action} on ` +
          `child ${e.child.id} (key=${e.key}); keeper=${keeper.child.id} ` +
          `(${keeper.action.action}).`,
      );
    }
  }

  // Write back trimmed action arrays. Keep the rest of the child row alone.
  for (const [childId, indices] of toDemote) {
    const child = children.find((c) => c.id === childId);
    if (!child) continue;
    const actions = Array.isArray(child.ai_proposed_actions)
      ? child.ai_proposed_actions
      : [];
    const trimmed = actions.filter((_, i) => !indices.has(i));
    const { error: updateErr } = await admin
      .from("document_queue")
      .update({
        ai_proposed_actions: trimmed,
        // Surface to /review so the user understands why a card has fewer
        // proposed actions than its filename suggests. approval_reason is
        // already used elsewhere for routing notes — borrow that channel.
        approval_reason: "duplicate_of_sibling",
        updated_at: new Date().toISOString(),
      })
      .eq("id", childId);
    if (updateErr) {
      console.error(
        `[SIBLING-DEDUP] ${parentQueueId}: failed to write back child ${childId}: ${updateErr.message}`,
      );
    }
  }

  if (demotedCount > 0) {
    console.log(
      `[SIBLING-DEDUP] ${parentQueueId}: dedup pass complete — scanned ${children.length} ` +
        `children, demoted ${demotedCount} duplicate actions.`,
    );
  }
  return { scanned: children.length, demoted: demotedCount };
}
