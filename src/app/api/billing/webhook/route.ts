/**
 * POST /api/billing/webhook — Stripe events.
 *
 * Public route (no user session): authenticated by the Stripe signature over
 * the RAW body. Verify fast, process the lifecycle, return 200. A processing
 * error returns 500 so Stripe retries; a bad signature is 400.
 */
import { NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = request.headers.get("stripe-signature");
  if (!stripeConfigured() || !secret) {
    return NextResponse.json({ error: "Billing webhook not configured." }, { status: 503 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const raw = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error(`[stripe-webhook] processing ${event.type} failed:`, err);
    // 500 → Stripe redelivers; the mirror writes are idempotent so retry is safe.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
