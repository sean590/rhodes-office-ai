/**
 * Derived totals from investment_transactions rows. Spec 036.
 *
 * The same derivation runs in three places (`/api/investments`,
 * `/api/investments/[id]`, `/api/entities/[id]/investments`), so it lives
 * here to prevent drift.
 *
 * Important contract:
 *   - This function operates on PARENT-LEVEL transactions only. The caller
 *     must filter out member-split child rows (those with
 *     `parent_transaction_id IS NOT NULL` AND `member_directory_id IS NOT NULL`)
 *     before passing rows in. Spec 036 keeps member-split children for the
 *     orthogonal per-member allocation feature.
 *   - Rows whose `line_items` JSONB is empty fall back to "100% subscription"
 *     on contributions and "100% gross" on distributions, preserving totals
 *     for data created before this migration.
 *   - Adjustment rows (`adjusts_transaction_id IS NOT NULL`) are summed
 *     normally — their (possibly negative) `amount` and `line_items` add to
 *     the totals like any other row.
 */

import type { TransactionLineItem } from "@/lib/types/investments";

export interface TransactionTotalRow {
  transaction_type: string;
  amount: number | string;
  line_items?: TransactionLineItem[] | null;
  adjusts_transaction_id?: string | null;
}

export interface DerivedTotals {
  total_contributed: number;
  called_capital: number;
  total_distributed_gross: number;
  total_distributed_net: number;
  /** Number of contribution rows that fell back to "100% subscription". */
  contribution_fallback_count: number;
}

const SUBSCRIPTION_CATEGORY = "subscription";
const GROSS_DISTRIBUTION_CATEGORY = "gross_distribution";

/**
 * Compute called/contributed/distributed totals from a flat list of
 * parent-level rows.
 */
export function deriveTotalsFromTransactions(rows: TransactionTotalRow[]): DerivedTotals {
  let totalContributed = 0;
  let calledCapital = 0;
  let totalDistributedGross = 0;
  let totalDistributedNet = 0;
  let contributionFallbackCount = 0;

  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;

    const lineItems = Array.isArray(row.line_items) ? row.line_items : [];

    if (row.transaction_type === "contribution") {
      totalContributed += amount;
      if (lineItems.length === 0) {
        // Back-compat fallback: pre-spec-036 rows had no line_items, so we
        // treat the entire amount as subscription. This is the right answer
        // for almost all of Sean's existing data (everything was entered
        // before fees were a concept).
        calledCapital += amount;
        contributionFallbackCount++;
      } else {
        for (const li of lineItems) {
          if (li.category === SUBSCRIPTION_CATEGORY) {
            calledCapital += Number(li.amount) || 0;
          }
        }
      }
    } else if (row.transaction_type === "distribution") {
      if (lineItems.length === 0) {
        // Back-compat fallback: treat the whole amount as gross == net.
        totalDistributedGross += amount;
        totalDistributedNet += amount;
      } else {
        let gross = 0;
        let reductions = 0;
        for (const li of lineItems) {
          const liAmount = Number(li.amount) || 0;
          if (li.category === GROSS_DISTRIBUTION_CATEGORY) {
            gross += liAmount;
          } else {
            reductions += liAmount;
          }
        }
        totalDistributedGross += gross;
        // Net = parent.amount, which is what the writer reconciled to. We
        // could recompute (gross - reductions) here, but using parent.amount
        // is the source of truth and avoids double-rounding.
        totalDistributedNet += amount;
      }
    } else if (row.transaction_type === "return_of_capital") {
      // Top-level all-or-nothing RoC. Counted as a distribution net amount;
      // gross == net since there's no waterfall on this form.
      totalDistributedGross += amount;
      totalDistributedNet += amount;
    }
  }

  return {
    total_contributed: totalContributed,
    called_capital: calledCapital,
    total_distributed_gross: totalDistributedGross,
    total_distributed_net: totalDistributedNet,
    contribution_fallback_count: contributionFallbackCount,
  };
}

/**
 * Compute called capital per investor from a flat list of parent-level rows.
 * Used by the investment detail route to populate per-investor uncalled
 * commitment.
 */
export function deriveCalledCapitalByInvestor(
  rows: Array<TransactionTotalRow & { investment_investor_id: string }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.transaction_type !== "contribution") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
    let called = 0;
    if (lineItems.length === 0) {
      called = amount; // back-compat fallback
    } else {
      for (const li of lineItems) {
        if (li.category === SUBSCRIPTION_CATEGORY) called += Number(li.amount) || 0;
      }
    }
    out[row.investment_investor_id] = (out[row.investment_investor_id] || 0) + called;
  }
  return out;
}
