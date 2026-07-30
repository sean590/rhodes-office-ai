-- 078: Inbound hardening — sender authentication + flood-cap digest state.
--
-- auth_results: Gmail's SPF/DKIM/DMARC verdicts for the message
--   ({spf, dkim, dmarc, verified}) — stored so held rows can show WHY and so
--   we can audit what unverified mail looked like.
-- last_cap_notice_on: the flood guard sends at most ONE digest notification
--   per day; this date is the atomic claim (update-where-not-today).

ALTER TABLE inbound_deliveries
  ADD COLUMN IF NOT EXISTS auth_results jsonb;

ALTER TABLE inbound_mail_state
  ADD COLUMN IF NOT EXISTS last_cap_notice_on date;
