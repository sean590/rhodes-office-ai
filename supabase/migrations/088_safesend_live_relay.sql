-- SafeSend live-relay retrieval (fixes the forwarded-code race).
--
-- Context: SafeSend's "awaiting access code" state is server-side, bound to the
-- LIVE browser session — it cannot be restored after the sandbox is torn down
-- (empirically confirmed: cookies + localStorage + sessionStorage all fail to
-- resume the code screen; re-opening forces a new Verify → a new code that
-- invalidates the forwarded one). So the retrieval must keep ONE session alive
-- and receive the forwarded code into it. This migration adds the state that
-- lets a separate inbound invocation hand a relayed code to the live attempt,
-- and a 'retrieving' status so the sweep can atomically claim a delivery
-- (preventing the overlapping-attempt / duplicate-OTP bug).

-- 1) New 'retrieving' status = a live retrieval attempt owns this row.
ALTER TABLE inbound_deliveries DROP CONSTRAINT IF EXISTS inbound_deliveries_status_check;
ALTER TABLE inbound_deliveries ADD CONSTRAINT inbound_deliveries_status_check
  CHECK (status IN ('pending','retrieving','ingested','retrieved','needs_user','acknowledged','waiting_code','resolved','dismissed','failed','ignored'));

-- 2) Relay hand-off: a forwarded access code, deposited by the inbound handler
--    for the org's live attempt to consume. relayed_code_at gates staleness —
--    the live attempt only accepts a code newer than its own start time, so a
--    code forwarded for a PRIOR attempt is ignored.
ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS relayed_access_code TEXT;
ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS relayed_code_at TIMESTAMPTZ;

-- 3) When the current attempt clicked Verify (and thus when its code was
--    issued). Also the atomic-claim timestamp used to reclaim stale
--    'retrieving' rows whose route died without transitioning them.
ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS retrieval_started_at TIMESTAMPTZ;
