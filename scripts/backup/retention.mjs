// Weekly archive retention: purge S3 copies of files deleted in the app.
//
// The nightly sync is append-only, so deletions in Supabase never propagate.
// This job closes the retention loop for offboarding/deletion promises:
//   1. Any archive object missing from the source bucket gets tagged with a
//      deletion-detected date on first sighting.
//   2. Once that tag is older than RETENTION_DAYS (default 90), ALL versions
//      of the object are deleted — the archive copy is fully gone.
//   3. If a file reappears in the source (restore/re-upload), its tag is
//      cleared so a later deletion restarts the clock.
//
// Runs under a dedicated IAM user scoped to storage/documents/* — it cannot
// touch the db/ dumps, and the nightly writer conversely cannot delete.
//
// PUBLIC-REPO LOG RULE: counts and dates only, never object paths.
//
// Env: BACKUP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_BUCKET,
//      RETENTION_DAYS (optional), TODAY (optional override for testing)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const SUPABASE_URL = process.env.BACKUP_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const S3_BUCKET = process.env.BACKUP_BUCKET;
const SOURCE_BUCKET = "documents";
const S3_PREFIX = `storage/${SOURCE_BUCKET}/`;
const TAG_KEY = "deletion-detected";
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
const TODAY = process.env.TODAY ? new Date(process.env.TODAY) : new Date();

if (!SUPABASE_URL || !SERVICE_KEY || !S3_BUCKET) {
  console.error("missing required env");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };

async function listSupabaseObjects() {
  const paths = new Set();
  const folders = [""];
  while (folders.length > 0) {
    const prefix = folders.pop();
    let offset = 0;
    for (;;) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SOURCE_BUCKET}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) throw new Error(`storage list failed: HTTP ${res.status}`);
      const entries = await res.json();
      for (const e of entries) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) folders.push(path);
        else paths.add(path);
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  }
  return paths;
}

async function listArchiveKeys() {
  const keys = [];
  let token;
  do {
    const args = ["s3api", "list-objects-v2", "--bucket", S3_BUCKET, "--prefix", S3_PREFIX, "--output", "json"];
    if (token) args.push("--starting-token", token);
    const { stdout } = await execFileP("aws", args, { maxBuffer: 64 * 1024 * 1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout) : {};
    for (const o of parsed.Contents ?? []) keys.push(o.Key);
    token = parsed.NextToken;
  } while (token);
  return keys;
}

async function getTag(key) {
  const { stdout } = await execFileP("aws", [
    "s3api", "get-object-tagging", "--bucket", S3_BUCKET, "--key", key, "--output", "json",
  ]);
  const tag = (JSON.parse(stdout).TagSet ?? []).find((t) => t.Key === TAG_KEY);
  return tag?.Value ?? null;
}

async function setTag(key, date) {
  await execFileP("aws", [
    "s3api", "put-object-tagging", "--bucket", S3_BUCKET, "--key", key,
    "--tagging", JSON.stringify({ TagSet: [{ Key: TAG_KEY, Value: date }] }),
  ]);
}

async function clearTag(key) {
  await execFileP("aws", ["s3api", "delete-object-tagging", "--bucket", S3_BUCKET, "--key", key]);
}

async function purgeAllVersions(key) {
  const { stdout } = await execFileP("aws", [
    "s3api", "list-object-versions", "--bucket", S3_BUCKET, "--prefix", key, "--output", "json",
  ]);
  const parsed = JSON.parse(stdout);
  const versions = [...(parsed.Versions ?? []), ...(parsed.DeleteMarkers ?? [])].filter((v) => v.Key === key);
  for (const v of versions) {
    await execFileP("aws", [
      "s3api", "delete-object", "--bucket", S3_BUCKET, "--key", key, "--version-id", v.VersionId,
    ]);
  }
}

const [source, archiveKeys] = await Promise.all([listSupabaseObjects(), listArchiveKeys()]);

const todayStr = TODAY.toISOString().slice(0, 10);
const cutoff = new Date(TODAY.getTime() - RETENTION_DAYS * 24 * 3600 * 1000);

let newlyTagged = 0;
let pending = 0;
let purged = 0;
let cleared = 0;

for (const key of archiveKeys) {
  const path = key.slice(S3_PREFIX.length);
  const existsInSource = source.has(path);
  const tagged = await getTag(key);
  if (existsInSource) {
    if (tagged) {
      await clearTag(key); // file came back — restart any future clock
      cleared += 1;
    }
    continue;
  }
  if (!tagged) {
    await setTag(key, todayStr);
    newlyTagged += 1;
  } else if (new Date(tagged) < cutoff) {
    await purgeAllVersions(key);
    purged += 1;
  } else {
    pending += 1;
  }
}

console.log(
  `archive: ${archiveKeys.length} | in source: ${source.size} | newly tagged: ${newlyTagged} | pending purge: ${pending} | purged: ${purged} | tags cleared: ${cleared}`,
);
