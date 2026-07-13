-- Migration 053: Enable Realtime on document_batches.
--
-- The NotificationBell in the app header subscribes to INSERT/UPDATE events
-- on document_batches so the badge count and dropdown entries reflect new
-- uploads and status transitions (processing -> review -> completed) without
-- polling.
--
-- RLS on document_batches restricts SELECT/UPDATE to authenticated users.
-- Org-level scoping is enforced by the API endpoint that the bell refetches
-- after a Realtime event; payloads themselves are only used as a refresh
-- trigger, never rendered directly.

ALTER PUBLICATION supabase_realtime ADD TABLE document_batches;
