#!/usr/bin/env bash
# Run the cross-tenant RLS isolation harness against a database.
# Uses $SUPABASE_DB_URL (env), falling back to the value in .env.local.
# Exits non-zero if any isolation assertion fails — suitable as a pre-deploy / CI gate.
#
#   npm run test:rls
#   SUPABASE_DB_URL=postgres://... npm run test:rls   # explicit target (e.g. staging)
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${SUPABASE_DB_URL:-}"
if [ -z "$URL" ] && [ -f .env.local ]; then
  URL=$(grep -E '^[[:space:]]*SUPABASE_DB_URL=' .env.local | head -1 | sed -E 's/^[^=]+=//' | tr -d '\042\047')
fi
if [ -z "$URL" ]; then
  echo "✗ SUPABASE_DB_URL not set (env or .env.local)"; exit 2
fi

echo "Running RLS isolation harness…"
psql "$URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
echo "✓ RLS isolation harness passed"
