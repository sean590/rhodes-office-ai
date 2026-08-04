/**
 * POST /api/billing/portal
 *
 * Owner-only. Opens a Stripe Billing Portal session for the org's customer
 * (update card, change plan, cancel) and returns the hosted URL.
 */
import { NextResponse } from "next/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { getOrgBilling } from "@/lib/billing/customer";

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

    const org = await getOrgBilling(orgId);
    if (!org?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account yet — start a subscription first." }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${origin}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/billing/portal error:", err);
    return NextResponse.json({ error: "Could not open the billing portal." }, { status: 500 });
  }
}
