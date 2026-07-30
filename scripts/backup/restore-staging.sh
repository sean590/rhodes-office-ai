#!/usr/bin/env bash
# Refresh the Supabase Staging branch from a production dump — with the
# org allowlist enforced (docs/backup-restore.md, "Staging data policy").
#
#   ALLOWED_ORG_IDS is the ONLY data permitted to exist on staging.
#   Customer data never leaves production. Changing the allowlist is a
#   deliberate, reviewed edit to this file.
#
# Usage:
#   SUPABASE_STAGING_DB_URL=<pooler url> scripts/backup/restore-staging.sh <dump-file>
#
#   Get the dump:   aws s3 cp s3://rhodes-backups/db/rhodes-YYYY-MM-DD.dump . \
#                     --profile rhodes   (read creds: see docs/backup-restore.md)
#   Get the URL:    supabase branches get Staging -o json → POSTGRES_URL
#                   (POOLER url — the direct db.<ref> host is IPv6-only)
#
# Codifies every lesson from the 2026-07-27 drill: schema reset instead of
# --clean, auth-before-public restore order with users first, re-granting
# role privileges (--no-privileges strips them), bucket recreation, and the
# storage.objects truncate (file objects never restore — metadata would
# dangle).

set -euo pipefail

# ── The allowlist ────────────────────────────────────────────────────
# Ridge Capital Management (Sean's own org). Add ids ONLY via reviewed PR.
ALLOWED_ORG_IDS=(
  "12b411c8-30df-4d3c-896c-80c7c90b5cca"
)

DUMP="${1:?usage: restore-staging.sh <dump-file>}"
DB="${SUPABASE_STAGING_DB_URL:?set SUPABASE_STAGING_DB_URL (staging branch POOLER url)}"

# Refuse to run against anything that looks like production.
if [[ "$DB" == *"flcrgrtrguulaeupyaza"* ]]; then
  echo "SUPABASE_STAGING_DB_URL points at the PRODUCTION project — refusing." >&2
  exit 1
fi

PG_RESTORE="${PG_RESTORE:-pg_restore}"
command -v "$PG_RESTORE" >/dev/null || PG_RESTORE=/opt/homebrew/opt/libpq/bin/pg_restore

ALLOWED_SQL=$(printf "('%s')," "${ALLOWED_ORG_IDS[@]}")
ALLOWED_SQL="${ALLOWED_SQL%,}"

echo "→ resetting public schema"
psql "$DB" -q <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE, CREATE ON SCHEMA public TO postgres, anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS supabase_functions;
TRUNCATE auth.users CASCADE;
SQL

echo "→ restoring auth (users first — data-only restore is alphabetical and breaks FKs otherwise)"
"$PG_RESTORE" -l "$DUMP" | grep 'TABLE DATA auth' | grep ' users ' > /tmp/toc-users
"$PG_RESTORE" -l "$DUMP" | grep 'TABLE DATA auth' | grep -v ' users ' > /tmp/toc-auth-rest
"$PG_RESTORE" --no-owner --no-privileges --data-only -L /tmp/toc-users -d "$DB" "$DUMP" 2>/dev/null || true
"$PG_RESTORE" --no-owner --no-privileges --data-only -L /tmp/toc-auth-rest -d "$DB" "$DUMP" 2>/dev/null || true

echo "→ restoring public schema"
"$PG_RESTORE" --no-owner --no-privileges --schema=public -d "$DB" "$DUMP" 2>/dev/null || true

echo "→ enforcing org allowlist (purging everything not in: ${ALLOWED_ORG_IDS[*]})"
psql "$DB" -q <<SQL
-- Allowlist into a temp table so dynamic SQL never embeds quoted literals.
CREATE TEMP TABLE _allowed_orgs(id uuid PRIMARY KEY);
INSERT INTO _allowed_orgs VALUES ($ALLOWED_SQL);
-- Org rows themselves (org-scoped tables cascade via FK).
DELETE FROM public.organizations WHERE id NOT IN (SELECT id FROM _allowed_orgs);
-- Belt and braces: any org-scoped row that survived a missing cascade.
DO \$\$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
      AND table_name <> 'organizations'
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM _allowed_orgs)',
      t.table_name
    );
  END LOOP;
END\$\$;
-- Auth users with no remaining org membership (cascades identities/factors).
DELETE FROM auth.users u WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_members m WHERE m.user_id = u.id
);
-- Storage metadata: file objects never restore, so rows would dangle; the
-- bucket re-accumulates from staging-side uploads.
DELETE FROM storage.objects WHERE bucket_id = 'documents';
INSERT INTO storage.buckets (id, name, public) VALUES ('documents','documents',false)
  ON CONFLICT (id) DO NOTHING;
SQL

echo "→ re-granting role privileges (--no-privileges strips them)"
psql "$DB" -q <<SQL
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
SQL

echo "→ result"
psql "$DB" -t -A <<'SQL'
SELECT 'organizations: ' || count(*) FROM public.organizations;
SELECT 'entities: ' || count(*) FROM public.entities;
SELECT 'documents: ' || count(*) FROM public.documents;
SELECT 'auth users: ' || count(*) FROM auth.users;
SQL
echo "✓ staging refreshed with allowlist enforced"
