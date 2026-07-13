// --- Investment types (v3 — with investment_investors) ---

export type InvestmentType = 'real_estate' | 'startup' | 'fund' | 'private_equity' | 'debt' | 'other';
export type InvestmentStatus = 'active' | 'exited' | 'winding_down' | 'committed' | 'defaulted';
export type InvestmentTransactionType = 'contribution' | 'distribution' | 'return_of_capital';
export type CoInvestorRole = 'co_investor' | 'promoter' | 'operator' | 'lender';

/**
 * Categories for investment_transactions.line_items entries.
 *
 * Contribution-side categories appear under transaction_type='contribution'.
 * Distribution-side categories appear under transaction_type='distribution'.
 * The two sets are disjoint, enforced by Zod in src/lib/validations.ts.
 *
 * Note: 'return_of_capital' appears here as a *line-item* category (a portion
 * of a distribution that is RoC) AND ALSO continues to exist as a top-level
 * `InvestmentTransactionType` for the all-or-nothing case. Both forms are
 * valid in v1 — the line-item form is for partial RoC distributions, the
 * top-level form is for transactions where the entire amount is RoC.
 */
export type TransactionLineItemCategory =
  // Contribution side
  | 'subscription'
  | 'management_fee'
  | 'monitoring_fee'
  | 'organizational_expense'
  | 'audit_tax_expense'
  | 'legal_expense'
  | 'late_fee'
  | 'other_contribution_expense'
  // Distribution side
  | 'gross_distribution'
  | 'operating_cashflows'
  | 'return_of_capital'
  | 'carried_interest'
  | 'compliance_holdback'
  | 'tax_withholding'
  | 'other_distribution_adjustment';

export const CONTRIBUTION_LINE_ITEM_CATEGORIES: ReadonlySet<TransactionLineItemCategory> = new Set([
  'subscription',
  'management_fee',
  'monitoring_fee',
  'organizational_expense',
  'audit_tax_expense',
  'legal_expense',
  'late_fee',
  'other_contribution_expense',
]);

export const DISTRIBUTION_LINE_ITEM_CATEGORIES: ReadonlySet<TransactionLineItemCategory> = new Set([
  'gross_distribution',
  'operating_cashflows',
  'return_of_capital',
  'carried_interest',
  'compliance_holdback',
  'tax_withholding',
  'other_distribution_adjustment',
]);

/**
 * One row in `investment_transactions.line_items`.
 *
 * IMPORTANT: the meaning of `amount` differs between contribution and
 * distribution rows.
 *
 * - On a contribution: amount is positive, and the sum of all line_items
 *   equals the parent transaction's `amount`.
 * - On a distribution: gross_distribution.amount is positive (the headline);
 *   every other category is also a positive number that gets SUBTRACTED
 *   from gross. The reconciliation rule is
 *   `gross_distribution - sum(reductions) = parent.amount`, where
 *   `parent.amount` is the NET delivered to the investor.
 *
 * Adjustment rows (rows where `adjusts_transaction_id` is set) may carry
 * negative amounts on either side of the asymmetry — e.g., a $5,000 recall
 * of a capital call is recorded as an adjustment row with
 * `amount = -5000` and a `subscription` line item with `amount = -5000`.
 */
export interface TransactionLineItem {
  category: TransactionLineItemCategory;
  amount: number;
  description: string | null;
}

export interface Investment {
  id: string;
  organization_id: string;
  name: string;
  short_name: string | null;
  investment_type: InvestmentType;
  status: InvestmentStatus;
  entity_id: string | null;
  description: string | null;
  formation_state: string | null;
  date_invested: string | null;
  date_exited: string | null;
  preferred_return_pct: number | null;
  preferred_return_basis: 'capital_contributed' | 'capital_committed' | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Joined
  investors?: InvestmentInvestor[];
  co_investors?: CoInvestor[];
}

export interface InvestmentInvestor {
  id: string;
  organization_id: string;
  investment_id: string;
  entity_id: string;
  entity_name?: string;
  capital_pct: number | null;
  profit_pct: number | null;
  committed_capital: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Computed
  called_capital?: number;
  uncalled_capital?: number;
  // Joined
  allocations?: InvestmentAllocation[];
}

export interface CoInvestor {
  id: string;
  investment_id: string;
  directory_entry_id: string;
  directory_entry_name?: string;
  role: CoInvestorRole;
  capital_pct: number | null;
  profit_pct: number | null;
  notes: string | null;
}

export interface InvestmentSummary extends Investment {
  investor_count: number;
  investor_names: string[];
  participant_count: number;
  total_committed: number;
  total_contributed: number;
  total_distributed: number;
  // New in spec 036: derived from line_items.
  called_capital: number;
  uncalled_capital: number;
  total_distributed_gross: number;
  total_distributed_net: number;
}

export interface InvestmentAllocation {
  id: string;
  organization_id: string;
  investment_investor_id: string;
  member_directory_id: string | null;
  member_entity_id?: string | null;
  allocation_pct: number;
  committed_amount: number | null;
  effective_date: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Joined fields
  member_name?: string;
}

export interface InvestmentTransaction {
  id: string;
  organization_id: string;
  investment_investor_id: string;
  member_directory_id: string | null;
  transaction_type: InvestmentTransactionType;
  amount: number;
  transaction_date: string;
  document_id: string | null;
  description: string | null;
  parent_transaction_id: string | null;
  // New in spec 036.
  line_items: TransactionLineItem[];
  adjusts_transaction_id: string | null;
  adjustment_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Joined fields
  member_name?: string;
  document_name?: string;
  investor_entity_name?: string;
  child_transactions?: InvestmentTransaction[];
}
