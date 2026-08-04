import Stripe from "stripe";

/**
 * Server-side Stripe client. Lazily initialized from STRIPE_SECRET_KEY so
 * importing this module never throws at build time / when Stripe isn't wired.
 */
let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
