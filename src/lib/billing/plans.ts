/**
 * Plan catalog — the single source of truth for trial limits and the paid plan.
 *
 * Stripe products/prices are created ONCE (setup script or dashboard, in test
 * mode first) and referenced here by id via env — code never hardcodes a Stripe
 * price id, so test/live and any re-pricing are just env swaps.
 *
 * Values below are from the go-live schedule; the founding $ price is finalized
 * on Day 14 (the price object can be swapped without code changes).
 */

export const TRIAL_DAYS = 30;

// Trial guards (enforced Day 5): one entity, 100 documents.
export const TRIAL_ENTITY_LIMIT = 1;
export const TRIAL_DOC_LIMIT = 100;

// Paid-plan visible meter: 200 documents / month.
export const MONTHLY_DOC_METER = 200;

export type PlanKey = "trial" | "founding";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Stripe price id (from env; undefined until the price is created + wired). */
  priceId: string | undefined;
  interval: "month";
}

export const FOUNDING: Plan = {
  key: "founding",
  name: "Rhodes — Founding",
  priceId: process.env.STRIPE_PRICE_FOUNDING_MONTHLY,
  interval: "month",
};

export const PLANS: Record<Exclude<PlanKey, "trial">, Plan> = {
  founding: FOUNDING,
};

/** The price the checkout flow (Day 2) subscribes a converting trial to. */
export function defaultPaidPriceId(): string | undefined {
  return FOUNDING.priceId;
}
