/**
 * POST /api/billing/checkout  { interval: "month" | "year" }
 *
 * Owner-only. Creates a Stripe Checkout Session to subscribe the org's customer
 * to the Founding plan at the chosen interval, and returns the hosted URL. The
 * webhook (Day 3) is what actually flips the org to active on completion.
 */
import { NextResponse } from "next/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { type BillingInterval } from "@/lib/billing/plans";
import { resolvePriceId } from "@/lib/billing/prices";
import { ensureStripeCustomer } from "@/lib/billing/customer";
import { getRequestContext } from "@/lib/utils/audit";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { user, orgId } = ctx;
    if (user.orgRole !== "owner") {
      return NextResponse.json({ error: "Only the organization owner can manage billing." }, { status: 403 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const interval: BillingInterval = body?.interval === "year" ? "year" : "month";
    const priceId = await resolvePriceId(interval);
    if (!priceId) {
      return NextResponse.json({ error: `No Stripe price configured for ${interval}.` }, { status: 500 });
    }

    const customerId = await ensureStripeCustomer(orgId, user.email);
    const origin = new URL(request.url).origin;
    const stripe = getStripe();

    // Consent proof (audit A4): the affirmative act is this authenticated request,
    // so capture ip/ua HERE (a server-to-server webhook has neither) and stash on
    // the session metadata for the webhook's auto_renewal consent record. Stripe
    // metadata values are strings ≤500 chars.
    const reqCtx = getRequestContext(request.headers);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      success_url: `${origin}/settings/billing?checkout=success`,
      cancel_url: `${origin}/settings/billing?checkout=cancelled`,
      subscription_data: { metadata: { organization_id: orgId } },
      metadata: {
        organization_id: orgId,
        consent_ip: reqCtx.ipAddress ?? "",
        consent_ua: (reqCtx.userAgent ?? "").slice(0, 400),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/billing/checkout error:", err);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
  }
}
