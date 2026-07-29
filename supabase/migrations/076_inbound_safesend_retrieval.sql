-- SafeSend auto-retrieval (usable-bar item B): the delivery row carries the
-- download link and attempt count; 'waiting_code' = wizard verified, access
-- code went to the original recipient (relay loop — user forwards it in).
ALTER TABLE inbound_deliveries
  ADD COLUMN IF NOT EXISTS safesend_link TEXT,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

ALTER TABLE inbound_deliveries DROP CONSTRAINT IF EXISTS inbound_deliveries_status_check;
ALTER TABLE inbound_deliveries ADD CONSTRAINT inbound_deliveries_status_check
  CHECK (status IN ('pending','ingested','retrieved','needs_user','acknowledged','waiting_code','resolved','dismissed','failed','ignored'));
