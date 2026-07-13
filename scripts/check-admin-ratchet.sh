#!/usr/bin/env bash
# Ratchet on raw service-role admin-client usage.
#
# The service-role client (createAdminClient) bypasses RLS, so every call site
# must manually scope queries by organization_id — a footgun. createOrgClient()
# removes the footgun for org-owned tables. We can't migrate all ~120 files at
# once, so this gate just makes sure the number of files importing the raw
# client only ever goes DOWN. New code that reaches for the raw client (instead
# of the wrapper) trips this in CI.
#
#   npm run check:admin-ratchet
#
# When you migrate a file off createAdminClient, lower BASELINE to match the
# new count (the script prints it). The wrapper + its definition are excluded.
set -euo pipefail
cd "$(dirname "$0")/.."

# Highest allowed number of files importing createAdminClient (excl. wrapper/defn).
# 71 (was 70): + api/auth/mfa-state — reads user_profiles.mfa_grace_until by user
# id for the MFA-enforcement cookie (an auth/users lookup, the exempt category).
BASELINE=71

# Count PRODUCTION files that reference the raw client. Excludes the wrapper and
# the definition itself, plus test files (they legitimately mock createAdminClient
# via vi.mock — that's not a real call site).
count=$(grep -rl "createAdminClient" src --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/supabase/org-client.ts" \
  | grep -v "src/lib/supabase/admin.ts" \
  | grep -vE "__tests__/|\.test\.tsx?$" \
  | wc -l | tr -d ' ')

echo "raw createAdminClient importers: ${count} (baseline ${BASELINE})"

if [ "$count" -gt "$BASELINE" ]; then
  echo "✗ raw admin-client usage INCREASED ($BASELINE → $count)."
  echo "  New code should use createOrgClient(orgId) from @/lib/supabase/org-client."
  echo "  If a raw client is genuinely required (auth/storage/child table/system job),"
  echo "  it's fine — but raise BASELINE in this script deliberately and say why."
  exit 1
fi

if [ "$count" -lt "$BASELINE" ]; then
  echo "✓ usage decreased — lower BASELINE in scripts/check-admin-ratchet.sh to ${count} to lock in the win."
else
  echo "✓ no increase."
fi
