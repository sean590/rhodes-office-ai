/**
 * Entitlement resolution — the single place that turns an org's billing columns
 * into "what can this org do right now". Pure (no I/O) so it's trivially
 * testable; callers pass the org's billing row. The actual doc-count enforcement
 * (comparing usage against docLimit) lands with the usage counters (Day 5/9).
 */
import { TRIAL_DOC_LIMIT, MONTHLY_DOC_METER } from "./plans";

export type BillingState = "trial" | "trial_expired" | "active" | "past_due" | "canceled" | "none";

export interface OrgBillingRow {
  billing_plan: string | null;
  billing_status: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean | null;
}

export interface Entitlements {
  state: BillingState;
  /** App is usable (active paid, in-dunning grace, or live trial). */
  isActive: boolean;
  /** Whole days left in the trial (null when not on a trial). */
  trialDaysLeft: number | null;
  /** Docs allowed in the current window. */
  docLimit: number;
  meterWindow: "trial" | "month" | null;
  /** New uploads permitted (state-level; the count check is separate). */
  canUpload: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveEntitlements(org: OrgBillingRow, now: Date = new Date()): Entitlements {
  const status = (org.billing_status ?? "").toLowerCase();

  // Paid, in good standing (Stripe 'active'/'trialing' map to active use).
  if (status === "active" || status === "trialing") {
    return { state: "active", isActive: true, trialDaysLeft: null, docLimit: MONTHLY_DOC_METER, meterWindow: "month", canUpload: true };
  }

  // Dunning: keep access during Stripe's retry window; the banner nudges to fix.
  if (status === "past_due") {
    return { state: "past_due", isActive: true, trialDaysLeft: null, docLimit: MONTHLY_DOC_METER, meterWindow: "month", canUpload: true };
  }

  if (status === "canceled") {
    return { state: "canceled", isActive: false, trialDaysLeft: null, docLimit: MONTHLY_DOC_METER, meterWindow: null, canUpload: false };
  }

  // Trial (plan='trial' with a trial clock).
  if (org.trial_ends_at) {
    const ends = new Date(org.trial_ends_at).getTime();
    if (ends > now.getTime()) {
      const trialDaysLeft = Math.max(0, Math.ceil((ends - now.getTime()) / DAY_MS));
      return { state: "trial", isActive: true, trialDaysLeft, docLimit: TRIAL_DOC_LIMIT, meterWindow: "trial", canUpload: true };
    }
    return { state: "trial_expired", isActive: false, trialDaysLeft: 0, docLimit: TRIAL_DOC_LIMIT, meterWindow: "trial", canUpload: false };
  }

  return { state: "none", isActive: false, trialDaysLeft: null, docLimit: TRIAL_DOC_LIMIT, meterWindow: null, canUpload: false };
}
