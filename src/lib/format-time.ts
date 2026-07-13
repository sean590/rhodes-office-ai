/**
 * format-time — the one place timestamps get rendered for the Action Inbox.
 *
 * Spec rule (UX refresh §5): a staged/activity time is ALWAYS date + time,
 * never time alone. "Today 11:26am", "Yesterday 5:27pm", "Jun 5 · 3:40pm".
 * This keeps an item's *staged time* legible without a separate day header,
 * and stays distinct from an action's own *data dates* (a filing's due date,
 * a K-1's tax year) — those use `formatDate` (date only, no time).
 */

function timePart(d: Date): string {
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(/\s/g, "");
}

function datePart(d: Date, now: Date): string {
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    "en-US",
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
}

function daysApart(d: Date, now: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Stamped time for staged actions / activity: date + time, never time alone. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const time = timePart(d);
  const days = daysApart(d, now);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${datePart(d, now)} · ${time}`;
}

/** A data date with no time component (tax year, due date, filed-on). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return datePart(d, new Date());
}

/** Compliance due dates: relative, with an overdue flag for styling. */
export function formatDue(iso: string): { text: string; overdue: boolean } {
  const days = Math.round((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, overdue: true };
  if (days === 0) return { text: "due today", overdue: true };
  return { text: `due in ${days}d`, overdue: false };
}
