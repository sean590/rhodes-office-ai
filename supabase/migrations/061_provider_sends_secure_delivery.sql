-- Secure-delivery columns for provider_document_sends.
--
-- Phase 1 sends documents to providers via a secure-delivery vendor (SendSafely
-- default, behind the swappable SecureDelivery interface) — NOT as plaintext
-- email attachments, since these carry PII (SSNs, EINs, account numbers).
--
-- delivery_provider records which SecureDelivery impl handled the send;
-- delivery_ref stores the vendor package / secure-link id (never the live URL —
-- links are sensitive and expiring). Replaces resend_message_id, which assumed
-- the file went out as a Resend email attachment (the rejected insecure path).

ALTER TABLE provider_document_sends
  ADD COLUMN delivery_provider TEXT,   -- 'sendsafely' | 'box' | 'rhodes_native'
  ADD COLUMN delivery_ref TEXT;        -- vendor package / secure-link id (NOT the URL)

ALTER TABLE provider_document_sends
  DROP COLUMN IF EXISTS resend_message_id;
