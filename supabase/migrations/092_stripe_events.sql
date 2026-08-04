-- Stripe webhook idempotency guard. Stripe re-delivers events (retries, at-least-
-- once), so a handler with non-idempotent side effects (e.g. inserting a consent
-- record on checkout.session.completed) would double-write. We record each
-- processed event id and skip anything already seen — making the whole webhook
-- handler exactly-once regardless of Stripe re-deliveries. Rows are tiny; a
-- periodic prune (>90d) can be added later if ever needed.
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,           -- Stripe event id (evt_…)
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
