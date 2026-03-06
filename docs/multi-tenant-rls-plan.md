# Multi-Tenant RLS Plan — Before Allowing External Users

This document outlines the database-level security changes required before opening Rhodes AI to users outside the internal team. Currently, org-scoping is enforced at the application layer (API routes). These changes add defense-in-depth at the Postgres level.

## Current State

- **RLS is enabled** on all tables (after migration 013)
- **Policies are permissive**: every authenticated user can SELECT/INSERT/UPDATE/DELETE any row
- **Org isolation is enforced in API routes** via `requireOrg()` + `.eq("organization_id", orgId)` and `validateEntityOrg()` for sub-entity routes
- **Mutations use the admin client** (service role key), which bypasses RLS entirely

## Why This Matters

With permissive RLS, a malicious authenticated user could use the Supabase client directly (via the anon key + their JWT) to query rows belonging to other organizations. The API routes prevent this, but the database itself does not.

## Migration Plan

### 1. Create a reusable helper function

```sql
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid();
$$;
```

This returns all org IDs the current user belongs to. Using `SECURITY DEFINER` + `STABLE` keeps it performant and avoids RLS recursion.

### 2. Replace policies on Tier A tables (have `organization_id` directly)

These tables have an `organization_id` column and can be scoped directly:

| Table | Notes |
|-------|-------|
| `entities` | |
| `documents` | |
| `directory_entries` | |
| `relationships` | |
| `chat_sessions` | |
| `chat_messages` | Scope via `chat_sessions.organization_id` join, or add `organization_id` column |
| `document_batches` | |
| `document_queue` | |
| `document_types` | |
| `custom_field_definitions` | |
| `compliance_obligations` | |
| `audit_log` | |
| `organizations` | Scope: user can only see orgs they belong to |
| `organization_members` | Scope: user can only see members of their own org |
| `organization_invites` | Scope: user can only see invites for their own org |

**Pattern for each table:**

```sql
-- Drop old permissive policies
DROP POLICY IF EXISTS "authenticated_select" ON <table>;
DROP POLICY IF EXISTS "authenticated_insert" ON <table>;
DROP POLICY IF EXISTS "authenticated_update" ON <table>;
DROP POLICY IF EXISTS "authenticated_delete" ON <table>;

-- New org-scoped policies
CREATE POLICY "org_select" ON <table>
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "org_insert" ON <table>
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "org_update" ON <table>
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT user_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "org_delete" ON <table>
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT user_org_ids()));
```

### 3. Replace policies on Tier B tables (sub-entity, no `organization_id`)

These tables reference a parent entity and need a JOIN to check org membership:

| Table | Parent FK |
|-------|-----------|
| `entity_registrations` | `entity_id -> entities.id` |
| `entity_state_ids` | `entity_id -> entities.id` |
| `entity_managers` | `entity_id -> entities.id` |
| `entity_members` | `entity_id -> entities.id` |
| `entity_filings` | `entity_id -> entities.id` |
| `entity_roles` | `entity_id -> entities.id` |
| `entity_partnership_reps` | `entity_id -> entities.id` |
| `trust_details` | `entity_id -> entities.id` |
| `trust_roles` | `entity_id -> entities.id` |
| `custom_field_values` | `entity_id -> entities.id` |
| `cap_table_entries` | `entity_id -> entities.id` |
| `relationship_documents` | `relationship_id -> relationships.id` |

**Pattern:**

```sql
CREATE POLICY "org_select" ON <table>
  FOR SELECT TO authenticated
  USING (entity_id IN (
    SELECT id FROM entities WHERE organization_id IN (SELECT user_org_ids())
  ));
```

For `relationship_documents`, chain through `relationships`:
```sql
USING (relationship_id IN (
  SELECT id FROM relationships WHERE organization_id IN (SELECT user_org_ids())
));
```

### 4. Special cases

**`users` table**: Scope to the user's own row:
```sql
USING (id = auth.uid())
```

**`user_profiles` table**: Same — scope to own row:
```sql
USING (id = auth.uid())
```

**`state_filing_requirements`**: This is reference data (not org-specific). Keep SELECT permissive, restrict INSERT/UPDATE/DELETE to service role only:
```sql
CREATE POLICY "anyone_can_read" ON state_filing_requirements
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies for authenticated (admin client handles writes)
```

**`waitlist` table**: Public insert is correct (anonymous signups). Clean up duplicate policy.

### 5. Performance considerations

- Add an index on `organization_members(user_id, organization_id)` if not already present — this is the hot path for every RLS check
- The `user_org_ids()` function is marked `STABLE` so Postgres caches it within a transaction
- Tier B sub-queries through `entities` will use the existing `entities.organization_id` index
- Test query plans with `EXPLAIN ANALYZE` after applying policies

### 6. Migration to admin client

Currently, mutations use `createAdminClient()` which bypasses RLS. This is fine — the admin client is only used server-side in API routes that already enforce org-scoping. No change needed.

Read operations use `createClient()` (user JWT), so they WILL be affected by these policy changes. Test all read paths.

### 7. Testing checklist

- [ ] User A cannot SELECT entities belonging to User B's org
- [ ] User A cannot INSERT into another org (organization_id mismatch rejected)
- [ ] Sub-entity reads (registrations, members, trust roles) are scoped correctly
- [ ] Chat sessions are only visible to the owning org
- [ ] Audit log is scoped to the user's org
- [ ] Document uploads/reads respect org boundaries
- [ ] Admin client (service role) still works for all mutations
- [ ] Performance: page loads don't regress (check entity list, directory, documents)

### 8. Cleanup

After applying org-scoped policies, the 78 "RLS Policy Always True" warnings in Supabase Security Advisor will be resolved. The only remaining permissive policies should be:
- `state_filing_requirements` SELECT (reference data)
- `waitlist` INSERT (public signup)
