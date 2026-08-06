/**
 * Stripe webhook lifecycle → org billing state. The route verifies the
 * signature and hands the event here. Stripe is the source of truth; we mirror
 * status / price / period into the organizations row so entitlements.ts can read
 * it synchronously. State writes are idempotent (last-writer-wins on the mirror),
 * so Stripe re-deliveries are safe.
 */
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "./stripe";
import { recordConsent, CONSENT_DOC_VERSION } from "./consent";

type Admin = ReturnType<typeof createAdminClient>;

/** Stripe subscription.status → our billing_status. */
export function mapSubStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "past_due";
  }
}

async function orgIdForCustomer(admin: Admin, customerId: string | null, hint?: string | null): Promise<string | null> {
  if (hint) {
    const { data } = await admin.from("organizations").select("id").eq("id", hint).maybeSingle();
    if (data) return hint;
  }
  if (!customerId) return null;
  const { data } = await admin.from("organizations").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data?.id as string) ?? null;
}

async function syncSubscription(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const orgId = await orgIdForCustomer(admin, customerId, sub.metadata?.organization_id);
  if (!orgId) {
    console.error("[stripe-webhook] no org for subscription", sub.id, "customer", customerId);
    return;
  }
  const item = sub.items.data[0];
  const periodEndUnix = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const status = mapSubStatus(sub.status);
  await admin
    .from("organizations")
    .update({
      billing_plan: "founding",
      billing_status: status,
      stripe_subscription_id: sub.id,
      stripe_price_id: item?.price?.id ?? null,
      current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      // Clear the cancellation clock on any non-canceled sync (reactivation) so a
      // future cancel restarts the 30-day retention window from scratch. `undefined`
      // is omitted by supabase-js, so the canceled case is left to the stamp below.
      subscription_ended_at: status === "canceled" ? undefined : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  if (status === "canceled") await stampSubscriptionEnded(admin, orgId);
}

/** Stamp the cancellation time ONCE (first canceled event wins) so the retention
 *  clock isn't reset by a later re-delivery or a second canceled event. */
async function stampSubscriptionEnded(admin: Admin, orgId: string): Promise<void> {
  await admin
    .from("organizations")
    .update({ subscription_ended_at: new Date().toISOString() })
    .eq("id", orgId)
    .is("subscription_ended_at", null);
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const admin = createAdminClient();

  // Idempotency: atomically claim the event id (INSERT ... ON CONFLICT DO
  // NOTHING). If nothing was inserted, Stripe is re-delivering an event we've
  // already processed — skip, so non-idempotent side effects (the consent
  // insert) run exactly once even under retries / concurrent deliveries.
  const { data: claimed } = await admin
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (!claimed || claimed.length === 0) {
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.organization_id ?? null;
      // Auto-renewal consent trail: the customer entered a recurring
      // subscription at checkout (ARL record). ip/ua aren't available in a
      // server-to-server webhook, so the checkout route captured them at
      // initiation and stashed them on the session metadata (audit A4).
      if (orgId) {
        await recordConsent(admin, {
          organizationId: orgId,
          consentType: "auto_renewal",
          documentVersion: CONSENT_DOC_VERSION,
          ipAddress: session.metadata?.consent_ip || null,
          userAgent: session.metadata?.consent_ua || null,
          metadata: { stripe_session_id: session.id, mode: session.mode, subscription: session.subscription },
        });
      }
      if (typeof session.subscription === "string") {
        const sub = await getStripe().subscriptions.retrieve(session.subscription);
        await syncSubscription(admin, sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscription(admin, event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      const orgId = await orgIdForCustomer(admin, customerId, sub.metadata?.organization_id);
      if (orgId) {
        await admin
          .from("organizations")
          .update({ billing_status: "canceled", cancel_at_period_end: false, updated_at: new Date().toISOString() })
          .eq("id", orgId);
        await stampSubscriptionEnded(admin, orgId); // starts the 30-day retention clock
      }
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;
      const orgId = await orgIdForCustomer(admin, customerId);
      if (orgId) {
        await admin
          .from("organizations")
          .update({ billing_status: "past_due", updated_at: new Date().toISOString() })
          .eq("id", orgId);
      }
      break;
    }
    default:
      // Unhandled event types are acknowledged (200) and ignored.
      break;
  }
}
