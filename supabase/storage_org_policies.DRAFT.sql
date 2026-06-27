-- storage_org_policies.DRAFT.sql — DRAFT, **DO NOT APPLY AS-IS**.
--
-- CURRENT STATE (2026-06-27): the `documents` bucket is PRIVATE and
-- storage.objects has RLS ENABLED with ZERO policies → that is DENY-ALL for the
-- anon/authenticated roles. The app reaches files only via the service-role
-- client + short-lived signed URLs (which bypass RLS). This is the most secure
-- posture and is what we want for now — DO NOT loosen it.
--
-- These policies would ENABLE org-scoped *direct* authenticated storage access.
-- Only apply them IF a client-side direct-storage feature is introduced, AND
-- only AFTER the object paths are normalized so the FIRST folder is ALWAYS the
-- org_id. Today ~270 of ~724 objects do NOT lead with an org id:
--   * ~223 lead with a different uuid (batch / entity / user id)
--   * 'unassociated' (37), 'queue' (5), 'chat-vision' (4)
-- A first-folder=org_id policy would mis-scope all of those, so normalize first.
--
-- Note: compares the first folder as TEXT to the user's org ids (no ::uuid cast),
-- so non-uuid folders simply don't match (clean deny) instead of erroring.

-- READ: only objects whose first path folder is one of the caller's orgs.
CREATE POLICY documents_org_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.organizations WHERE id IN (SELECT public.user_org_ids())
    )
  );

-- INSERT: may upload only under one of the caller's org prefixes.
CREATE POLICY documents_org_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.organizations WHERE id IN (SELECT public.user_org_ids())
    )
  );

-- UPDATE: may modify only objects under the caller's org prefix (and keep them there).
CREATE POLICY documents_org_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.organizations WHERE id IN (SELECT public.user_org_ids()))
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.organizations WHERE id IN (SELECT public.user_org_ids()))
  );

-- DELETE: may delete only objects under the caller's org prefix.
CREATE POLICY documents_org_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.organizations WHERE id IN (SELECT public.user_org_ids()))
  );
