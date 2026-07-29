-- Inbound UI states (rhodes-inbound-v1-ui-spec.md):
-- 1. 'acknowledged' status — user clicked "I forwarded it": stops email
--    reminders, keeps the Home card (subdued, "waiting for it to arrive")
--    until the document actually lands (auto-resolve). Resolution is the
--    document arriving, never the click.
-- 2. Poll health on inbound_mail_state — powers the Settings → Mailbox
--    connection chip (Connected / Connection problem).

ALTER TABLE inbound_deliveries DROP CONSTRAINT IF EXISTS inbound_deliveries_status_check;
ALTER TABLE inbound_deliveries ADD CONSTRAINT inbound_deliveries_status_check
  CHECK (status IN ('pending','ingested','retrieved','needs_user','acknowledged','resolved','dismissed','failed','ignored'));

ALTER TABLE inbound_mail_state
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;
