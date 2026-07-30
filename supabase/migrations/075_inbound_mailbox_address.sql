-- The connected mailbox's own address (from the Gmail profile), recorded on
-- each successful poll. The Settings page displays THIS — the address is a
-- property of the connection, not config (config drifted from reality once
-- already: rdgcp alias vs the actual Rhodes@channels.com mailbox).
ALTER TABLE inbound_mail_state
  ADD COLUMN IF NOT EXISTS mailbox_address TEXT;
