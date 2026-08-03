import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerBatchFiles } from "@/lib/pipeline/register-files";
import { sendEmail } from "@/lib/email";
import { inboundNeedsYouEmail } from "@/lib/email-templates";
import { waitForOtp, gmailConfigured } from "./gmail";
import { SAFESEND_DRIVER_SOURCE } from "./safesend-driver";

/**
 * SafeSend auto-retrieval (usable-bar item B — the agentic fetch).
 *
 * Runs the deterministic wizard driver in a Vercel Sandbox (our own vendor
 * boundary; ephemeral VM per retrieval). The wizard clicks Verify — which is
 * what makes SafeSend email the 8-digit code — and then KEEPS THE SESSION
 * ALIVE at the code screen for the full window. SafeSend binds the "awaiting
 * code" state to the live browser session server-side (confirmed empirically:
 * it can't be restored after teardown, and re-opening forces a new Verify →
 * a new code that invalidates the prior one), so we must feed the code into
 * THIS live attempt rather than respin.
 *
 * The code reaches the live attempt two ways, raced:
 *   1. Gmail inline — waitForOtp polls Rhodes' Gmail (direct deliveries, or a
 *      code forwarded to the Gmail address).
 *   2. DB relay (transport-agnostic) — when the original recipient forwards the
 *      code to ANY of the org's addresses (Gmail or the SES hosted address),
 *      the inbound handler deposits it on this delivery row (relayed_access_code)
 *      and this loop picks it up. Works for orgs without Gmail.
 * The "forward the code" nudge fires the moment Verify sends (onVerifySent),
 * while the window is live — not after it dies.
 *
 * Outcomes: retrieved (files → the ONE pipeline) · waiting_code (window elapsed
 * with no code; the sweep re-attempts) · needs_user (locked/expired/attempts
 * exhausted — the standing nothing-silently-missed fallback).
 */

const MAX_ATTEMPTS = 2; // SafeSend locks links after repeated code requests
// Live window we hold the verified session open, waiting for the code. Bounded
// by the retrieve-safesend route's maxDuration (800s) minus boot/verify/download
// overhead — see src/app/api/cron/retrieve-safesend/route.ts.
const OTP_WAIT_MS = 10 * 60_000;

type Admin = ReturnType<typeof createAdminClient>;

export type SafesendDelivery = {
  id: string;
  organization_id: string;
  sender: string;
  subject: string | null;
  safesend_link: string;
  safesend_links?: string[] | null;
  attempts: number;
};

export type RetrievalResult =
  | { outcome: "retrieved"; batchId: string; documentIds: string[]; files: number }
  | { outcome: "waiting_code"; recipient: string }
  | { outcome: "needs_user"; reason: string };

function isOrgForwarder(sender: string, subject: string | null): boolean {
  return /^\s*(fwd|fw):/i.test(subject ?? "");
}

export async function retrieveSafesend(
  admin: Admin,
  delivery: SafesendDelivery,
  opts: { mailboxAddress: string; onVerifySent?: (recipient: string) => Promise<void> },
): Promise<RetrievalResult> {
  // Original recipient: the forwarder for relayed deliveries, Rhodes itself
  // for direct ones.
  const recipient = isOrgForwarder(delivery.sender, delivery.subject)
    ? delivery.sender
    : opts.mailboxAddress;

  // Sandbox must outlive boot (~40s) + verify (~30s) + the OTP window (10m) +
  // download (~60s) — kept under the route's 800s maxDuration.
  const sandbox = await Sandbox.create({ runtime: "node22", timeout: 13 * 60_000 });
  try {
    // Toolchain: playwright chromium + AL2023 libs (validated 2026-07-29,
    // ~26s). No LLM anywhere in this loop.
    await run(sandbox, "npm", ["init", "-y"]);
    await run(sandbox, "npm", ["i", "playwright-core@1.56.1"]);
    await run(sandbox, "npx", ["-y", "playwright@1.56.1", "install", "chromium", "--no-shell"]);
    await run(sandbox, "sudo", [
      "dnf", "install", "-y", "-q",
      "nss", "nspr", "atk", "at-spi2-atk", "cups-libs", "libdrm", "libXcomposite",
      "libXdamage", "libXrandr", "libgbm", "libxkbcommon", "pango", "alsa-lib",
      "at-spi2-core", "libXfixes", "cairo",
    ]);
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/driver.mjs", content: Buffer.from(SAFESEND_DRIVER_SOURCE) },
    ]);

    // Launch the driver detached, then watch its status file while ALSO
    // watching the mailbox for the access code.
    const driver = await sandbox.runCommand({
      cmd: "node",
      args: ["driver.mjs"],
      cwd: "/vercel/sandbox",
      env: {
        SS_LINKS: (delivery.safesend_links?.length ? delivery.safesend_links : [delivery.safesend_link]).join(","),
        SS_LINK: delivery.safesend_link,
        SS_RECIPIENT: recipient,
        SS_OTP_WAIT_MS: String(OTP_WAIT_MS),
      },
      detached: true,
    });

    // Wait for VERIFY_SENT (or terminal LOCKED/EXPIRED) before OTP-watching —
    // the code is only triggered by the Verify click.
    const early = await waitStatus(sandbox, ["VERIFY_SENT", "LOCKED", "EXPIRED", "FAILED"], 90_000);
    if (early === "LOCKED") return { outcome: "needs_user", reason: "safesend link locked (too many attempts) — retry in ~30 minutes or download manually" };
    if (early === "EXPIRED") return { outcome: "needs_user", reason: "safesend link expired — ask the sender to re-share, or upload manually" };
    if (early === "FAILED wrong-address") {
      return {
        outcome: "needs_user",
        reason: `SafeSend didn't accept ${recipient} as the recipient — the delivery was addressed to someone else. Forward the files directly, or have the original recipient forward the delivery email.`,
      };
    }
    if (early?.startsWith("FAILED") || early === null) return { outcome: "needs_user", reason: `safesend wizard failed (${early ?? "no status"})` };

    // Verify just fired → the code is now in flight to `recipient`, and the
    // session is live at the code screen. Prompt the forward NOW (while the
    // window is open), and stamp the attempt start so the DB relay only feeds
    // us a code newer than this Verify (never a stale one from a prior attempt).
    const verifiedAt = new Date();
    await admin
      .from("inbound_deliveries")
      .update({ retrieval_started_at: verifiedAt.toISOString(), updated_at: verifiedAt.toISOString() })
      .eq("id", delivery.id);
    await opts.onVerifySent?.(recipient).catch(() => {});

    // Race two code sources for the live window; first hit wins and is typed
    // into the still-open box. Gmail inline (direct/Gmail-forwarded) OR the
    // transport-agnostic DB relay (recipient forwards to any org address → the
    // inbound handler deposits it here). Whichever resolves a code, we write it.
    const code = await Promise.race([
      gmailConfigured()
        ? waitForOtp({ bodyMarker: /access code|safesend/i, digits: 8, timeoutMs: OTP_WAIT_MS, pollMs: 6_000 }).catch(() => null)
        : new Promise<string | null>(() => {}), // never resolves — lets the relay win
      pollRelayedCode(admin, delivery.id, verifiedAt, OTP_WAIT_MS, 5_000),
    ]);
    if (code) {
      await sandbox.writeFiles([{ path: "/vercel/sandbox/otp.txt", content: Buffer.from(code) }]);
    }
    // No code within the window → the driver times out on its own; classified below.

    const final = await waitStatus(sandbox, ["DOWNLOADED", "FAILED"], OTP_WAIT_MS + 120_000);
    if (final?.startsWith("DOWNLOADED")) {
      const ingest = await ingestDownloads(admin, delivery);
      return { outcome: "retrieved", ...ingest };
    }
    if (final === "FAILED otp-timeout") return { outcome: "waiting_code", recipient };
    return { outcome: "needs_user", reason: `safesend retrieval failed (${final ?? "no status"})` };

    async function ingestDownloads(admin: Admin, d: SafesendDelivery) {
      const ls = await sandbox.runCommand({ cmd: "ls", args: ["/vercel/sandbox/downloads"] });
      const names = (await ls.stdout()).split("\n").map((s) => s.trim()).filter(Boolean);
      const { data: batch, error } = await admin
        .from("document_batches")
        .insert({
          name: `Secure link from ${d.sender}${d.subject ? ` — ${d.subject.slice(0, 100)}` : ""}`,
          context: "global",
          entity_discovery: true,
          created_by: await ownerId(admin, d.organization_id),
          organization_id: d.organization_id,
          metadata: { source: "safesend_retrieval", inbound_delivery_id: d.id },
        })
        .select("id")
        .single();
      if (error || !batch) throw new Error(`batch create failed: ${error?.message}`);
      const batchId = batch.id as string;

      const files = [];
      for (const name of names) {
        const stream = await sandbox.readFile({ path: `/vercel/sandbox/downloads/${name}` });
        if (!stream) continue;
        const bytes = await streamToBuffer(stream);
        // ZIPs from "Download All": unpack server-side.
        const entries = name.toLowerCase().endsWith(".zip") ? await unzip(bytes) : [{ name, bytes }];
        for (const e of entries) {
          const safe = e.name.replace(/[^\w.\- ()]/g, "_");
          const storagePath = `${d.organization_id}/queue/${batchId}/${Date.now()}-${safe}`;
          const { error: upErr } = await admin.storage
            .from("documents")
            .upload(storagePath, e.bytes, { upsert: false });
          if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
          files.push({
            originalName: e.name,
            storagePath,
            size: e.bytes.length,
            type: e.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : null,
            contentHash: createHash("sha256").update(e.bytes).digest("hex"),
          });
        }
      }
      const reg = await registerBatchFiles({
        orgId: d.organization_id,
        userId: await ownerId(admin, d.organization_id),
        batchId,
        files,
        sourceType: "email_inbound",
      });
      if (reg.uploaded.length > 0) {
        await admin.from("document_queue").update({ status: "queued", updated_at: new Date().toISOString() }).eq("batch_id", batchId).eq("status", "staged");
        await admin.from("document_batches").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", batchId);
      }
      return {
        batchId,
        documentIds: reg.uploaded.map((u) => u.document_id).filter((x): x is string => typeof x === "string"),
        files: files.length,
      };
    }
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

/** Nudge for the relay loop: the code went to the original recipient. */
export async function nudgeForCode(admin: Admin, delivery: SafesendDelivery, recipient: string, mailboxAddress: string) {
  try {
    const { data: admins } = await admin.from("user_profiles").select("id").eq("role", "admin");
    const ids = (admins || []).map((a) => a.id);
    const { data: { users } } = await admin.auth.admin.listUsers();
    const emails = (users || []).filter((u) => ids.includes(u.id) && u.email).map((u) => u.email!);
    const { html } = inboundNeedsYouEmail({ sender: delivery.sender, subject: delivery.subject, forwardAddress: mailboxAddress });
    for (const to of emails) {
      await sendEmail({
        to,
        subject: `Rhodes needs the SafeSend access code (sent to ${recipient})`,
        html,
      });
    }
  } catch (err) {
    console.error("[SAFESEND] nudge failed:", err);
  }
}

// ── helpers ──────────────────────────────────────────────────────────

async function run(sandbox: Sandbox, cmd: string, args: string[]) {
  const r = await sandbox.runCommand({ cmd, args, cwd: "/vercel/sandbox" });
  if (r.exitCode !== 0) throw new Error(`${cmd} ${args[0]} failed (${r.exitCode}): ${(await r.stderr()).slice(-200)}`);
}

/**
 * Poll this delivery row for a code the inbound handler relayed in — i.e. the
 * recipient forwarded the SafeSend code to one of the org's addresses and the
 * handler deposited it here. Only accept a code stamped at/after this attempt's
 * Verify (`since`); anything older is a leftover from a prior attempt (SafeSend
 * would have invalidated it) and must be ignored. Resolves null at timeout.
 */
async function pollRelayedCode(admin: Admin, deliveryId: string, since: Date, timeoutMs: number, pollMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await admin
      .from("inbound_deliveries")
      .select("relayed_access_code, relayed_code_at")
      .eq("id", deliveryId)
      .maybeSingle();
    const code = data?.relayed_access_code as string | null | undefined;
    const at = data?.relayed_code_at as string | null | undefined;
    if (code && at && new Date(at).getTime() >= since.getTime()) return code;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

async function waitStatus(sandbox: Sandbox, prefixes: string[], timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cat = await sandbox.runCommand({ cmd: "cat", args: ["/vercel/sandbox/status.txt"] });
    const lines = (await cat.stdout()).split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines.reverse()) {
      if (prefixes.some((p) => line.startsWith(p))) return line;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}

async function ownerId(admin: Admin, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string) ?? null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function unzip(bytes: Buffer): Promise<Array<{ name: string; bytes: Buffer }>> {
  // exceljs ships jszip-compatible unzip via its dependency chain; avoid new
  // deps by shelling to `unzip`... not available in serverless. Use the zlib
  // central-directory walk via the small dedicated dep instead.
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(bytes);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.startsWith("__MACOSX"))
    .map((e) => ({ name: e.entryName.split("/").pop() || e.entryName, bytes: e.getData() }));
}
