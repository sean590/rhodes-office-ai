/**
 * Org ↔ Stripe customer glue. The single billing module that touches the
 * organizations row with the admin client (billing columns are owner-gated in
 * the routes; RLS org-client isn't the right tool for the Stripe mirror).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "./stripe";

export interface OrgBilling {
  id: string;
  name: string | null;
  billing_email: string | null;
  stripe_customer_id: string | null;
}

export async function getOrgBilling(orgId: string): Promise<OrgBilling | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("id, name, billing_email, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  return (data as OrgBilling) ?? null;
}

/**
 * Return the org's Stripe customer id, creating (and persisting) one on first
 * use. `email` falls back through billing_email → the acting user's email.
 */
export async function ensureStripeCustomer(orgId: string, actingUserEmail: string): Promise<string> {
  const org = await getOrgBilling(orgId);
  if (!org) throw new Error("organization not found");
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: org.billing_email || actingUserEmail || undefined,
    name: org.name || undefined,
    metadata: { organization_id: orgId },
  });

  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("id", orgId);

  return customer.id;
}
