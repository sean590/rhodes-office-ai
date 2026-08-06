/**
 * Money plausibility guards for the extraction/apply path.
 *
 * Origin: the extraction model emitted cap-table capital 100× too large —
 * writing $350,000 as 35000000 (a cents-scale / trailing-zeros error) while its
 * own reasoning said "$350,000". The bad value was auto-applied and later
 * surfaced verbatim in chat, looking like a hallucination. Two backstops:
 *
 *  1. WHOLE_DOLLARS_HINT — attached to every extractable money field so the
 *     model is told the unit explicitly (the root-cause fix; see entities-write
 *     / investments-write).
 *  2. assertPlausibleMoney + the cap-table anchor check — numeric backstops at
 *     apply time. A thrown MoneyError is caught per-action in apply.ts and the
 *     action is surfaced as failed for review, never silently written.
 *
 * Note the limit of a pure-numeric guard: a UNIFORM 100× error is internally
 * consistent (every member ÷ its % implies the same wrong total), so it can only
 * be caught against an EXTERNAL anchor — here the entity's linked investment
 * committed capital. Absent an anchor, only the absolute ceiling applies.
 */

export const WHOLE_DOLLARS_HINT =
  "Amount in WHOLE US DOLLARS as an integer — e.g. 350000 for $350,000. Do NOT write cents or append two zeros: 35000000 means $35,000,000 (a 100× error).";

/**
 * Absolute sanity ceiling for a single money field ($100B default, env-tunable).
 * A single position above this is implausible enough to be corruption, not a
 * real number. Deliberately high — the anchor check catches in-range 100×.
 */
export const MAX_MONEY_USD = Number(process.env.MAX_MONEY_USD) || 100_000_000_000;

/** Ratio at which a cap-table entry's implied total dwarfs its anchor enough to
 *  be treated as a likely scale error rather than a real (if lumpy) cap table. */
export const CAP_TABLE_ANCHOR_FACTOR = 25;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Throw unless `value` is a plausible whole-dollar amount. No-op for
 * null/undefined — callers pass only when a value is present (fields are
 * optional). Rejects non-finite, negative, fractional (cents), and absurd.
 */
export function assertPlausibleMoney(
  value: number | null | undefined,
  field = "amount",
): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) throw new MoneyError(`${field} is not a finite number`);
  if (value < 0) throw new MoneyError(`${field} cannot be negative`);
  if (!Number.isInteger(value)) throw new MoneyError(`${field} must be whole US dollars (no cents)`);
  if (value > MAX_MONEY_USD) {
    throw new MoneyError(
      `${field} of $${value.toLocaleString()} exceeds the $${MAX_MONEY_USD.toLocaleString()} sanity ceiling — likely a 100× (cents) error`,
    );
  }
}

/** Total capital implied by one member's contribution and ownership %, or null
 *  when it can't be computed (missing/zero %). */
export function impliedCapTableTotal(
  capital: number | null | undefined,
  ownershipPct: number | null | undefined,
): number | null {
  if (!Number.isFinite(capital as number) || !Number.isFinite(ownershipPct as number)) return null;
  if ((ownershipPct as number) <= 0) return null;
  return (capital as number) / ((ownershipPct as number) / 100);
}

/**
 * True when a cap-table entry's implied total dwarfs the entity's known anchor
 * (its linked investment's committed capital) by ≥ `factor`. Anchor ≤ 0 or an
 * uncomputable implied total → false (no opinion; never a false positive).
 */
export function exceedsAnchor(
  impliedTotal: number | null,
  anchorTotal: number | null | undefined,
  factor = CAP_TABLE_ANCHOR_FACTOR,
): boolean {
  if (impliedTotal === null) return false;
  if (!Number.isFinite(anchorTotal as number) || (anchorTotal as number) <= 0) return false;
  return impliedTotal / (anchorTotal as number) >= factor;
}
