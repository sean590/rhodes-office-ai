// Shared upload primitive for batch-style document uploads.
//
// Walks the standard pipeline: create batch → presign → upload to Storage
// (with SHA-256 hashing) → register with the batch → kick off processing.
// Used by:
//   - Chat drawer's batch-mode branch (uploads of 6+ files via chat)
//   - /review page's drop zone (any number of files)
//
// Returns the new batch's id so callers can link to /batches/[id] or insert
// follow-up rows referencing it. Throws on any HTTP failure with a clear
// message; callers are responsible for catching and surfacing to the user.
//
// NOT used by chat-drawer's chat-mode (1–5 docs) — that path needs presign
// metadata for /api/chat attachments and was intentionally left as inline
// code in chat-drawer.tsx to avoid regression risk.

export interface BatchUploadOptions {
  /** Display name for the batch row. Optional; backend defaults to null. */
  name?: string;
  /** Batch context — drives source labeling in the notification dropdown. */
  context: "chat" | "review_page" | "entity" | "global";
  /** Optional entity scope. When set, all documents are tied to this entity. */
  entityId?: string | null;
  /** Free-form JSONB stored on the batch (e.g., { session_id } for chat). */
  metadata?: Record<string, unknown>;
}

export interface BatchUploadResult {
  batchId: string;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadFilesToBatch(
  files: File[],
  options: BatchUploadOptions,
): Promise<BatchUploadResult> {
  if (files.length === 0) throw new Error("No files to upload");

  // 1. Create batch.
  const batchRes = await fetch("/api/pipeline/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: options.name ?? `Upload — ${files.length} document${files.length === 1 ? "" : "s"}`,
      context: options.context,
      entity_id: options.entityId ?? null,
      metadata: options.metadata ?? {},
    }),
  });
  if (!batchRes.ok) throw new Error("Failed to create upload batch");
  const batch = (await batchRes.json()) as { id: string };

  // 2. Presign upload URLs.
  const presignRes = await fetch(`/api/pipeline/batches/${batch.id}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    }),
  });
  if (!presignRes.ok) throw new Error("Failed to presign uploads");
  const presignData = (await presignRes.json()) as {
    urls: Array<{
      originalName: string; safeName: string; storagePath: string;
      signedUrl: string; token: string;
    }>;
  };

  // 3. Upload each file to Storage with SHA-256.
  const fileHashes: string[] = [];
  for (let i = 0; i < presignData.urls.length; i++) {
    const { signedUrl, token } = presignData.urls[i];
    const file = files[i];
    const buf = await file.arrayBuffer();
    fileHashes.push(await sha256Hex(buf));
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
        Authorization: `Bearer ${token}`,
      },
      body: buf,
    });
    if (!uploadRes.ok) throw new Error(`Failed to upload ${file.name}`);
  }

  // 4. Register uploaded files with the batch.
  const registerRes = await fetch(`/api/pipeline/batches/${batch.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: presignData.urls.map((u, i) => ({
        originalName: u.originalName,
        storagePath: u.storagePath,
        size: files[i].size,
        type: files[i].type,
        contentHash: fileHashes[i],
      })),
    }),
  });
  if (!registerRes.ok) throw new Error("Failed to register uploads");

  // 5. Kick off background processing.
  await fetch(`/api/pipeline/batches/${batch.id}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  return { batchId: batch.id };
}
