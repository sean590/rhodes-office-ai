-- audit_log.user_id references the legacy public.users table, but the app
-- stores auth.users UUIDs. Drop the old FK and reference auth.users instead.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
