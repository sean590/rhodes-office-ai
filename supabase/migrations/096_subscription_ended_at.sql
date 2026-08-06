-- A13+A8: the expiry→deletion cron needs to know WHEN a subscription was
-- canceled to start the 30-day retention clock. Stripe cancellation only set
-- billing_status='canceled' (no timestamp). Add subscription_ended_at, stamped
-- by the webhook on the first transition to canceled (and cleared on
-- reactivation), so the sweep can select "canceled ≥ 30 days ago".
--
-- Trials don't need this — their clock anchors on the existing trial_ends_at.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ;
