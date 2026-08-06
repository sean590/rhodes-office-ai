/**
 * Stripe price resolution (audit A2). Resolve the active price by its stable
 * lookup_key rather than a hardcoded/env price id, so a test→live cutover needs
 * no env swap: recreate the live-mode prices with the SAME lookup keys and the
 * running key resolves the mode-correct price automatically. Falls back to the
 * env-configured price id if the lookup key isn't set on any active price yet.
 */
import { getStripe } from "./stripe";
import { priceLookupKey, priceIdFor, type BillingInterval } from "./plans";

export async function resolvePriceId(interval: BillingInterval): Promise<string | undefined> {
  const lookupKey = priceLookupKey(interval);
  try {
    const stripe = getStripe();
    const res = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (res.data[0]?.id) return res.data[0].id;
    console.warn(`[billing] no active price for lookup_key '${lookupKey}' — falling back to env id`);
  } catch (err) {
    console.error(`[billing] price lookup by '${lookupKey}' failed:`, err instanceof Error ? err.message : err);
  }
  return priceIdFor(interval);
}
