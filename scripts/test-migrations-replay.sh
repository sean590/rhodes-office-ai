#!/usr/bin/env bash
#
# Migration replay gate — proves the migration files in supabase/migrations/
# build a correct, RLS-secured schema FROM SCRATCH (the thing a Supabase branch
# does). Catches the class of failure that left the Staging branch in
# MIGRATIONS_FAILED: a later migration referencing a table/column/policy that no
# earlier migration creates (hand-applied prod drift never captured in a file).
#
# It spins up a throwaway local Postgres database, stubs the handful of
# Supabase-provided constructs the migrations assume (auth schema + auth.uid(),
# the anon/authenticated/service_role roles, the supabase_realtime publication,
# default grants), replays every migration in order, then runs the RLS isolation
# harness against the result. Exits non-zero on the first failure.
#
# Usage:
#   npm run test:migrations          # needs a local Postgres on :5432
#   PGHOST=... PGPORT=... PGUSER=... npm run test:migrations
#
# This is a from-scratch REPLAY check; it never touches production. Run it before
# merging any migration so `supabase branches` (Staging) can never regress.
set -euo pipefail
cd "$(dirname "$0")/.."

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-$(whoami)}"
DB="${MIGRATION_TEST_DB:-rhodes_migration_test}"
PSQL_ADMIN=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)
PSQL_DB=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -v ON_ERROR_STOP=1 -q)

echo "→ migration replay gate (scratch db: $DB @ $PGHOST:$PGPORT)"

if ! pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  echo "✗ no Postgres reachable at $PGHOST:$PGPORT. Start one (e.g. brew services start postgresql) or set PGHOST/PGPORT." >&2
  exit 1
fi

# Cluster-global roles Supabase provides (idempotent).
for r in anon authenticated service_role supabase_admin authenticator; do
  "${PSQL_ADMIN[@]}" -d postgres -c \
    "DO \$\$ BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
done

# Fresh scratch database.
"${PSQL_ADMIN[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

# Bootstrap the Supabase-provided constructs the migrations assume exist. This is
# NOT part of the app schema — it's what a real Supabase project/branch supplies.
"${PSQL_DB[@]}" >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz DEFAULT now()
);
-- Mirrors Supabase's real auth.uid(): dotted claim, else the claims JSON blob.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claim.role', true), 'authenticated')
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
SQL

# Replay every migration in filename order. (Rollback scripts live in
# supabase/rollbacks/, NOT here, so they don't run.)
#
# CRITICAL: mirror Supabase's runner, which only accepts a PURELY-NUMERIC
# version prefix (^[0-9]+_). A lettered file like "002a_foo.sql" is silently
# SKIPPED by Supabase — so we must skip it here too, or this gate would pass on
# a migration set that fails the real branch build (exactly how the 002a fix
# looked green locally but Staging still failed at 013).
count=0
for f in $(ls supabase/migrations/*.sql | sort); do
  base=$(basename "$f")
  if [[ ! "$base" =~ ^[0-9]+_ ]]; then
    echo "  ⚠ SKIPPING $base — non-numeric prefix; Supabase ignores it (put the SQL in a NNN_ file)" >&2
    continue
  fi
  if ! out=$("${PSQL_DB[@]}" -f "$f" 2>&1); then
    echo "✗ FAILED at $base:" >&2
    echo "$out" | grep -iE "error" | head -5 >&2
    exit 1
  fi
  count=$((count + 1))
done
echo "✓ $count migrations replayed clean from scratch"

# Supabase grants table/sequence/function access to these roles by default; RLS
# then filters. Apply after replay so the RLS harness can exercise policies.
"${PSQL_DB[@]}" >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
SQL

# Prove the replayed schema is actually secured (org isolation, cross-tenant
# write denial, non-member blindness). The harness rolls itself back. Capture
# the output first (don't pipe into grep -q — that closes the pipe early and
# SIGPIPEs psql, which pipefail would read as a failure).
rls_out="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -f supabase/tests/rls_isolation_test.sql 2>&1 || true)"
if grep -q "ALL RLS ISOLATION TESTS PASSED" <<<"$rls_out"; then
  echo "✓ RLS isolation tests passed on the replayed schema"
else
  echo "✗ RLS isolation tests FAILED on the replayed schema" >&2
  grep -iE "fail|error" <<<"$rls_out" | head >&2
  exit 1
fi

# Clean up unless KEEP_MIGRATION_TEST_DB is set (leave it for inspection).
if [ -z "${KEEP_MIGRATION_TEST_DB:-}" ]; then
  "${PSQL_ADMIN[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
fi

echo "✅ migration replay gate passed — the migration set builds a clean, RLS-secured schema from scratch."
