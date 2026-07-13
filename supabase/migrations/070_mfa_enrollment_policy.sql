-- 070_mfa_enrollment_policy.sql — MFA enrollment grace window (Phase 2, Increment 3).
-- Apply by hand in the Supabase SQL editor (CLI migration history is empty).
--
-- Each user gets a grace deadline (set on first login, in auth/callback) by which
-- they must enroll an MFA factor. During grace they can use the app (nagged) but
-- are blocked from enrollment-gated sensitive actions; past grace, app access is
-- blocked until they enroll. NULL = grace not yet initialized.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mfa_grace_until TIMESTAMPTZ;
