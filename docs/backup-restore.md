# Backup & Restore

Independent off-site backup of production data (security audit P0-4),
supplementing Supabase's own daily backups. Nothing here depends on Supabase
infrastructure being available.

## What runs

`.github/workflows/nightly-backup.yml` — nightly at 09:00 UTC (~1am PT), plus
manual `workflow_dispatch`:

1. **Database**: `pg_dump -Fc` of the `public`, `storage`, and `auth` schemas
   (app data, file metadata, users) → `s3://rhodes-backups/db/rhodes-YYYY-MM-DD.dump`.
   Fails on a suspiciously small dump (<500 KB; normal is ~1.4 MB) and on
   upload size mismatch.
2. **Documents**: `scripts/backup/storage-sync.mjs` diffs the Supabase
   `documents` bucket against `s3://rhodes-backups/storage/documents/` by
   key + size and uploads new/changed files. Append-only: deletions in
   Supabase are never propagated by the sync; overwrites are preserved by
   S3 versioning.

`.github/workflows/backup-retention.yml` — weekly (Sundays 10:00 UTC):
closes the deletion loop the append-only sync leaves open. An archive file
missing from the source bucket is tagged with a detection date on first
sighting; once the tag is 90 days old (`RETENTION_DAYS`), every version of
the object is deleted. Files that reappear get their tag cleared. Net
policy: **a file deleted in the app is recoverable from the archive for
~90 days, then fully purged** — this is the deletion/offboarding promise
the backups uphold. Runs under IAM user `rhodes-backup-retention`, which
can tag/delete only under `storage/documents/` (never the `db/` dumps);
the nightly writer conversely cannot delete anything. Database rows of
deleted data age out automatically as old dumps expire at 90 days.

## Where it lives

- **AWS account `925432502482`** — dedicated to Rhodes, separate from all
  other infrastructure. Console access: Sean.
- **Bucket `rhodes-backups` (us-west-2, same region as Supabase)**: block all
  public access, versioning ON, SSE-S3 encryption, TLS-only bucket policy.
- **Lifecycle**: `db/` dumps → Infrequent Access at 30 days, deleted at 90
  days (nightly cadence makes older dumps redundant); `storage/` archive kept
  indefinitely, overwritten versions expire after 90 days.
- **Credentials**: the workflow uses IAM user `rhodes-backup-writer` whose
  entire policy is `s3:PutObject` on the bucket + `s3:ListBucket`. A leaked
  writer key cannot read, delete, or silently replace history (versioning).
  Restores use a separate credential created at need by `rhodes-admin`.

## Failure alerting

GitHub emails the repo owner when a scheduled workflow run fails — every
failure mode in the workflow (dump error, small dump, upload mismatch, any
storage-sync failure) exits non-zero to trigger that. Spot-check freshness
during the quarterly drill: the newest `db/` object should be <25h old.

## RPO / RTO

- **RPO: 24 hours** via this pipeline (nightly). Sub-hour recovery within
  Supabase's own retention window may be possible via their PITR/daily
  backups — check plan status in the dashboard; treat as bonus, not baseline.
- **RTO target: ≤4 hours** for full-loss recovery (new Supabase project +
  restore + env repoint + redeploy). The drill validates the mechanics.

## Restore procedures

Restores need a read credential: as `rhodes-admin`, either use the console or
mint a temporary key with `s3:GetObject`/`s3:ListBucket` on `rhodes-backups`,
and delete it after the restore.

### Scenario 1 — accidental deletion of specific rows

1. Try Supabase PITR/daily backup first if within retention.
2. Otherwise: download the latest dump, restore it to the staging project,
   extract the rows, re-insert into production:

```bash
aws s3 cp s3://rhodes-backups/db/rhodes-YYYY-MM-DD.dump .
# Use the POOLER connection string (`supabase branches get Staging`) — the
# direct db.<ref>.supabase.co host is IPv6-only and won't resolve on most
# local networks. `--clean` fails on cross-schema dependents; reset the
# schema instead:
psql "$STAGING_DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; \
  GRANT USAGE, CREATE ON SCHEMA public TO postgres, anon, authenticated, service_role; \
  CREATE SCHEMA IF NOT EXISTS supabase_functions;"
pg_restore --no-owner --no-privileges --schema=public \
  -d "$STAGING_DB_URL" rhodes-YYYY-MM-DD.dump
# query staging, re-insert into prod deliberately (never blind-restore prod)
```

### Scenario 2 — full database loss / Supabase outage

1. Create a new Supabase project (us-west-2).
2. Restore: `public` cleanly; `auth`/`storage` data must be reconciled with
   the schemas the new project ships (restore data only, not definitions):

```bash
# auth data FIRST (public tables have FKs to auth.users), and users before
# the rest of auth (data-only restore runs alphabetically, so identities/
# mfa_* would otherwise hit FK errors — seen in the 2026-07-27 drill):
pg_restore -l rhodes-YYYY-MM-DD.dump | grep 'TABLE DATA auth' | grep ' users ' > toc-users
pg_restore -l rhodes-YYYY-MM-DD.dump | grep 'TABLE DATA auth' | grep -v ' users ' > toc-auth-rest
pg_restore --no-owner --no-privileges --data-only -L toc-users -d "$NEW_DB_URL" rhodes-YYYY-MM-DD.dump
pg_restore --no-owner --no-privileges --data-only -L toc-auth-rest -d "$NEW_DB_URL" rhodes-YYYY-MM-DD.dump
# then public (schema + data), then storage metadata:
pg_restore --no-owner --no-privileges --schema=public -d "$NEW_DB_URL" rhodes-YYYY-MM-DD.dump
pg_restore --no-owner --no-privileges --data-only --schema=storage -d "$NEW_DB_URL" rhodes-YYYY-MM-DD.dump
```

Expected residual errors, safe to ignore: transient login-session tables
(`flow_state`, `sessions`, `mfa_challenges`, `mfa_amr_claims` — users simply
re-authenticate) and the `waitlist-welcome` trigger if the target lacks the
`supabase_functions.http_request()` webhook function (re-enable Database
Webhooks on the new project, then re-create the trigger).

3. Re-upload files from `s3://rhodes-backups/storage/documents/` into the new
   project's `documents` bucket (same paths — `storage.objects` metadata from
   the dump must match the uploaded keys).
4. Update Vercel env (Supabase URL, keys, `SUPABASE_DB_URL`), redeploy,
   verify `/api/health`, log in, spot-check documents download.

### Scenario 3 — lost/corrupted document files only

Files are under `s3://rhodes-backups/storage/documents/<original path>`.
Re-upload to Supabase Storage at the same path; metadata already references
it. Verify via the app's document download.

## Quarterly restore drill

Calendar: first week of Jan / Apr / Jul / Oct. Each drill: download latest
dump → restore to staging → row-count spot-check (entities, documents,
organizations) vs production → download 2–3 archived files and checksum
against Supabase originals → record below.

| Date | Dump restored | Result | Notes |
|------|---------------|--------|-------|
| 2026-07-27 | rhodes-2026-07-28.dump | PASS | Restored to the Staging branch. Row counts exact across organizations (1), entities (30), documents (517), directory_entries (35), document_queue (289), audit_log (1563), auth.users (13); identities + mfa_factors restored after the ordered auth pass. 3/3 sampled archive files sha256-match Supabase originals. Residuals: transient session tables + waitlist webhook trigger (documented above). |
