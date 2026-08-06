/**
 * Plan catalog — the single source of truth for trial allowance and the paid
 * plan's prices.
 *
 * Stripe products/prices are created ONCE (dashboard, test mode first) and
 * referenced here by id via env — code never hardcodes a Stripe price id, so
 * test/live and any re-pricing are just env swaps. Amounts below are for
 * display/copy only; Stripe is the source of truth for what's charged.
 */

export const TRIAL_DAYS = 30;

// Trial doc allowance (enforced Day 5 at presign). Deliberately NO entity cap —
// 100 docs is enough to stand up one or more entities, and multiple is a better
// activation outcome than an artificial one-entity wall.
export const TRIAL_DOC_LIMIT = 100;

// Paid monthly-plan limit: 200 documents / month (the only visible meter).
export const MONTHLY_DOC_METER = 200;

export type BillingInterval = "month" | "year";

export interface PriceRef {
  interval: BillingInterval;
  /** Display amount in USD (Stripe is the source of truth for the charge). */
  amountUsd: number;
  /** Stripe price id (from env; undefined until wired). Fallback for lookupKey. */
  priceId: string | undefined;
  /** Stable Stripe lookup_key — mode-correct across test/live so a live-mode
   *  cutover needs no env swap (audit A2). Resolved at checkout via prices.ts. */
  lookupKey: string;
}

/** The single paid plan at launch: "Founding", monthly or annual. */
export const FOUNDING = {
  key: "founding" as const,
  name: "Rhodes — Founding",
  prices: {
    month: { interval: "month", amountUsd: 150, priceId: process.env.STRIPE_PRICE_FOUNDING_MONTHLY, lookupKey: "founding_monthly" },
    year: { interval: "year", amountUsd: 1500, priceId: process.env.STRIPE_PRICE_FOUNDING_ANNUAL, lookupKey: "founding_annual" },
  } satisfies Record<BillingInterval, PriceRef>,
};

/** Env-configured Stripe price id for a billing interval — the fallback when a
 *  lookup-key resolution misses (see resolvePriceId in prices.ts). */
export function priceIdFor(interval: BillingInterval): string | undefined {
  return FOUNDING.prices[interval].priceId;
}

/** Stable Stripe lookup_key for a billing interval. */
export function priceLookupKey(interval: BillingInterval): string {
  return FOUNDING.prices[interval].lookupKey;
}
