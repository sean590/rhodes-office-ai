/**
 * DB-error helpers shared across the pipeline (worker, ingest, etc.).
 *
 * Born from an enum-mismatch bug: the worker tried to UPDATE a queue item's
 * status to 'password_required' before that value existed in the
 * queue_status enum; Postgres rejected the UPDATE; nobody checked the error
 * return; items stuck in 'extracting' forever with no signal that anything
 * was wrong. The helpers below force every mutation to either throw on
 * error (invariant transitions) or warn loudly (best-effort cascades),
 * eliminating silent no-ops.
 */

import * as Sentry from "@sentry/nextjs";

/**
 * Throw on Supabase mutation error. Use for state changes whose silence
 * breaks an invariant downstream (status transitions, batch stat updates,
 * etc.). The thrown error propagates to the calling worker loop, which
 * Sentries it and continues with the next item — so one bad row doesn't
 * tank the batch, but we get loud visibility instead of a silent no-op.
 */
export function assertNoDbError(error: unknown, context: string): void {
  if (!error) return;
  const e = error as { message?: string; code?: string; details?: string };
  const parts = [e.message ?? "unknown DB error"];
  if (e.code) parts.push(`(${e.code})`);
  if (e.details) parts.push(`— ${e.details}`);
  throw new Error(`[PIPELINE] ${context}: ${parts.join(" ")}`);
}

/**
 * Log-only counterpart. Use for best-effort cascades (progress UI,
 * child-item helpers, post-batch chat notifications) where a DB error
 * shouldn't tank the parent operation but should still be visible.
 */
export function logDbError(error: unknown, context: string): void {
  if (!error) return;
  const e = error as { message?: string; code?: string };
  console.warn(
    `[PIPELINE] ${context}: ${e.message ?? "unknown DB error"}${e.code ? ` (${e.code})` : ""}`,
  );
  Sentry.captureMessage(`Pipeline DB error: ${context}`, {
    level: "warning",
    extra: { error: e },
  });
}
