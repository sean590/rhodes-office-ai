// Nightly Supabase Storage -> S3 sync (append-only archive).
//
// Lists every object in the private `documents` bucket via the Storage API
// (service role), diffs against the S3 `storage/documents/` prefix by key +
// size, and uploads anything new or changed with `aws s3 cp`. Never deletes
// from S3 — deletions in Supabase leave the archived copy behind, and bucket
// versioning preserves history on overwrite.
//
// PUBLIC-REPO LOG RULE: this runs in GitHub Actions on a public repository,
// so nothing here may print object paths or file names — customer document
// names are sensitive. Output is counts and byte totals only.
//
// Env: BACKUP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_BUCKET
// (AWS credentials/region come from the environment for the aws CLI.)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileP = promisify(execFile);

const SUPABASE_URL = process.env.BACKUP_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const S3_BUCKET = process.env.BACKUP_BUCKET;
const SOURCE_BUCKET = "documents";
const S3_PREFIX = `storage/${SOURCE_BUCKET}/`;
const CONCURRENCY = 5;

if (!SUPABASE_URL || !SERVICE_KEY || !S3_BUCKET) {
  console.error("missing required env (BACKUP_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / BACKUP_BUCKET)");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };

// Recursively walk the Storage list API (it is per-folder, paginated).
async function listSupabaseObjects() {
  const objects = new Map(); // path -> size
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
        if (e.id === null) {
          folders.push(path); // folder placeholder
        } else {
          objects.set(path, e.metadata?.size ?? -1);
        }
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  }
  return objects;
}

// Inventory the S3 archive (writer credential has ListBucket, not GetObject).
async function listS3Objects() {
  const objects = new Map(); // path (sans prefix) -> size
  let token;
  do {
    const args = [
      "s3api", "list-objects-v2",
      "--bucket", S3_BUCKET,
      "--prefix", S3_PREFIX,
      "--output", "json",
    ];
    if (token) args.push("--starting-token", token);
    const { stdout } = await execFileP("aws", args, { maxBuffer: 64 * 1024 * 1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout) : {};
    for (const o of parsed.Contents ?? []) {
      objects.set(o.Key.slice(S3_PREFIX.length), o.Size);
    }
    token = parsed.NextToken;
  } while (token);
  return objects;
}

async function syncOne(path, tmpDir) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${SOURCE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers },
  );
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const tmpFile = join(tmpDir, `obj-${Math.random().toString(36).slice(2)}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpFile));
  const { size } = await stat(tmpFile);
  await execFileP("aws", ["s3", "cp", tmpFile, `s3://${S3_BUCKET}/${S3_PREFIX}${path}`, "--quiet"]);
  await rm(tmpFile, { force: true });
  return size;
}

const [source, archive] = await Promise.all([listSupabaseObjects(), listS3Objects()]);

const toSync = [...source.entries()]
  .filter(([path, size]) => archive.get(path) === undefined || (size >= 0 && archive.get(path) !== size))
  .map(([path]) => path);

const tmpDir = await mkdtemp(join(tmpdir(), "rhodes-sync-"));
let uploaded = 0;
let uploadedBytes = 0;
let failed = 0;

for (let i = 0; i < toSync.length; i += CONCURRENCY) {
  const batch = toSync.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map((p) => syncOne(p, tmpDir)));
  for (const r of results) {
    if (r.status === "fulfilled") {
      uploaded += 1;
      uploadedBytes += r.value;
    } else {
      failed += 1; // no path in the log — public repo
    }
  }
}
await rm(tmpDir, { recursive: true, force: true });

console.log(
  `source objects: ${source.size} | already archived: ${source.size - toSync.length} | uploaded: ${uploaded} (${(uploadedBytes / 1024 / 1024).toFixed(1)} MB) | failed: ${failed}`,
);
if (failed > 0) process.exit(1);
