import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerBatchFiles } from "@/lib/pipeline/register-files";
import { inferProviderFromSender } from "@/lib/providers/routing-rules";
import { sendEmail } from "@/lib/email";
import { inboundNeedsYouEmail } from "@/lib/email-templates";
import { gmailConfigured, listNewMessages, getAttachment, getMailboxAddress, type InboundMessage } from "./gmail";
import { triageMessage } from "./triage";

/**
 * Inbound v1 worker (rhodes-inbound-v1-build-plan.md) — one poll pass:
 * list new mailbox messages since the cursor, triage each, and guarantee the
 * invariant: every delivery-looking message ends ingested, retrieved, or as a
 * needs_user nudge (chat notification + admin email). Never silently missed.
 *
 * v1 is single-mailbox → one org (INBOUND_ORG_ID). Attachment batches are
 * staged→queued here and DRAINED BY the existing cron/process-queue sweeper —
 * this worker never runs extraction inline (serverless discipline).
 */

const MAX_PER_RUN = 15;
const FORWARD_ADDRESS = process.env.INBOUND_FORWARD_ADDRESS || "Rhodes@channels.com";

type Admin = ReturnType<typeof createAdminClient>;

export type InboundRunResult = {
  skipped?: string;
  scanned: number;
  ingested: number;
  needsUser: number;
  ignored: number;
  failed: number;
};

export async function processInboundMail(): Promise<InboundRunResult> {
  const result: InboundRunResult = { scanned: 0, ingested: 0, needsUser: 0, ignored: 0, failed: 0 };
  if (!gmailConfigured()) return { ...result, skipped: "gmail not configured" };
  const orgId = process.env.INBOUND_ORG_ID;
  if (!orgId) return { ...result, skipped: "INBOUND_ORG_ID not set" };

  const admin = createAdminClient();

  const { data: state } = await admin
    .from("inbound_mail_state")
    .select("last_internal_date")
    .eq("organization_id", orgId)
    .maybeSingle();
  const cursor = Number(state?.last_internal_date ?? 0) ||
    // First run: only look back 24h — never triage the whole historical inbox.
    Date.now() - 24 * 3600 * 1000;

  let messages: InboundMessage[];
  try {
    messages = (await listNewMessages(cursor, MAX_PER_RUN + 10)).slice(0, MAX_PER_RUN);
  } catch (err) {
    // Connection-level failure (token revoked, API outage): record it for the
    // Settings health chip and rethrow — mail isn't lost, the next poll
    // catches up from the same cursor.
    await admin.from("inbound_mail_state").upsert({
      organization_id: orgId,
      last_internal_date: cursor,
      last_error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
      updated_at: new Date().toISOString(),
    });
    throw err;
  }
  let maxSeen = cursor;

  for (const msg of messages) {
    result.scanned += 1;
    maxSeen = Math.max(maxSeen, msg.internalDate);
    try {
      await handleMessage(admin, orgId, msg, result);
    } catch (err) {
      result.failed += 1;
      console.error(`[INBOUND] message ${msg.id} failed:`, err);
      await admin
        .from("inbound_deliveries")
        .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "unknown", updated_at: new Date().toISOString() })
        .eq("gmail_message_id", msg.id);
    }
  }

  await retryFailedDeliveries(admin, orgId, result);
  await purgeIgnoredMetadata(admin, orgId);

  await admin.from("inbound_mail_state").upsert({
    organization_id: orgId,
    last_internal_date: maxSeen,
    last_success_at: new Date().toISOString(),
    last_error: null,
    // The connection's own identity — what the Settings page displays.
    mailbox_address: await getMailboxAddress(),
    updated_at: new Date().toISOString(),
  });

  return result;
}

async function handleMessage(admin: Admin, orgId: string, msg: InboundMessage, result: InboundRunResult) {
  const providerId = await inferProviderFromSender(admin, orgId, msg.fromEmail);
  const domain = msg.fromEmail.split("@").pop()?.toLowerCase() ?? "";
  const { data: learned } = await admin
    .from("inbound_delivery_senders")
    .select("kind")
    .eq("organization_id", orgId)
    .eq("domain", domain)
    .maybeSingle();
  const triage = triageMessage(msg, {
    knownProviderSender: Boolean(providerId),
    learnedDeliverySender: learned?.kind === "delivery",
  });

  // Idempotency: gmail_message_id is UNIQUE — if the row already exists this
  // message was handled by a previous run (or is mid-flight); skip it.
  const { data: inserted, error: insErr } = await admin
    .from("inbound_deliveries")
    .insert({
      organization_id: orgId,
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      sender: msg.fromEmail,
      subject: msg.subject.slice(0, 500) || null,
      received_at: new Date(msg.internalDate).toISOString(),
      classification: triage.classification,
      status: "pending",
      provider_id: providerId,
      needs_user_reason: triage.classification === "needs_user" || triage.classification === "safesend" ? triage.reason : null,
    })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") return; // already handled
    throw insErr;
  }
  const deliveryId = inserted.id as string;

  switch (triage.classification) {
    case "attachment": {
      const { batchId, documentIds } = await ingestAttachments(admin, orgId, msg, triage.ingestableAttachments);
      await admin
        .from("inbound_deliveries")
        .update({ status: "ingested", batch_id: batchId, document_ids: documentIds, updated_at: new Date().toISOString() })
        .eq("id", deliveryId);
      result.ingested += 1;
      await recordInboundOutcome(admin, orgId, "inbound_filed", deliveryId, { sender: msg.fromEmail, files: documentIds.length });
      await autoResolveOpenNudges(admin, orgId, providerId, msg.fromEmail, deliveryId);
      break;
    }
    case "safesend": {
      // Auto-retrieval: store the link; the retrieve cron picks 'pending'
      // safesend rows up (too slow to run inline in the poll).
      await admin
        .from("inbound_deliveries")
        .update({ safesend_link: triage.safesendLink, safesend_links: triage.safesendLinks, updated_at: new Date().toISOString() })
        .eq("id", deliveryId);
      result.needsUser += 0;
      break;
    }
    case "needs_user": {
      await notifyNeedsUser(admin, orgId, msg, triage.reason, deliveryId);
      result.needsUser += 1;
      break;
    }
    default: {
      // Relay resume: an otherwise-ignorable email carrying an 8-digit code
      // with SafeSend markers, while a delivery waits on its code, is the
      // user completing the loop — run the retrieval NOW with that code.
      const codeMatch = /access code|safesend/i.test(msg.subject + " " + msg.bodyText)
        ? (msg.bodyText + " " + msg.snippet).match(/(?<!\d)(\d{8})(?!\d)/)
        : null;
      if (codeMatch) {
        const { data: waiting } = await admin
          .from("inbound_deliveries")
          .select("id, organization_id, sender, subject, safesend_link, safesend_links, attempts")
          .eq("organization_id", orgId)
          .eq("status", "waiting_code")
          .not("safesend_link", "is", null)
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (waiting) {
          await admin
            .from("inbound_deliveries")
            .update({ status: "ignored", needs_user_reason: "access code relay", updated_at: new Date().toISOString() })
            .eq("id", deliveryId);
          result.ignored += 1;
          await runSafesendAttempt(admin, orgId, waiting as never, codeMatch[1]);
          return;
        }
      }
      await admin
        .from("inbound_deliveries")
        .update({ status: "ignored", updated_at: new Date().toISOString() })
        .eq("id", deliveryId);
      result.ignored += 1;
    }
  }
}

/**
 * Teach action (spec §3c "This is a delivery"): re-run full triage/dispatch on
 * a single message after the caller has upserted the learned delivery-sender
 * (and deleted the old ignored row — gmail_message_id is UNIQUE, so the stale
 * row must be gone before re-handling). Returns the fresh row's disposition.
 */
export async function reprocessInboundMessage(
  admin: Admin,
  orgId: string,
  msg: InboundMessage,
): Promise<{ deliveryId: string | null; status: string }> {
  const result: InboundRunResult = { scanned: 1, ingested: 0, needsUser: 0, ignored: 0, failed: 0 };
  await handleMessage(admin, orgId, msg, result);
  const { data } = await admin
    .from("inbound_deliveries")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("gmail_message_id", msg.id)
    .maybeSingle();
  return {
    deliveryId: (data?.id as string) ?? null,
    status: (data?.status as string) ?? "pending",
  };
}

// ── Attachment ingestion (the ONE pipeline; drained by cron/process-queue) ──

async function ingestAttachments(
  admin: Admin,
  orgId: string,
  msg: InboundMessage,
  attachments: InboundMessage["attachments"],
): Promise<{ batchId: string; documentIds: string[] }> {
  const ownerId = await orgOwnerId(admin, orgId);

  const senderLabel = msg.fromEmail.split("@")[0];
  const { data: batch, error: batchErr } = await admin
    .from("document_batches")
    .insert({
      name: `Email from ${msg.fromEmail}${msg.subject ? ` — ${msg.subject.slice(0, 120)}` : ""}`,
      context: "global",
      entity_discovery: true,
      created_by: ownerId, // chat narration needs a user; system source is in metadata
      organization_id: orgId,
      metadata: { source: "email_inbound", gmail_message_id: msg.id, sender: msg.fromEmail },
    })
    .select("id")
    .single();
  if (batchErr || !batch) throw new Error(`batch create failed: ${batchErr?.message}`);
  const batchId = batch.id as string;

  const files = [];
  for (const att of attachments) {
    const bytes = await getAttachment(msg.id, att.attachmentId);
    const safeName = att.filename.replace(/[^\w.\- ()]/g, "_") || "attachment";
    const storagePath = `${orgId}/queue/${batchId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(storagePath, bytes, { contentType: att.mimeType, upsert: false });
    if (upErr) throw new Error(`storage upload failed for ${senderLabel} attachment: ${upErr.message}`);
    files.push({
      originalName: att.filename,
      storagePath,
      size: bytes.length,
      type: att.mimeType,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  const reg = await registerBatchFiles({ orgId, userId: ownerId, batchId, files, sourceType: "email_inbound" });

  // staged → queued; the process-queue sweeper (every 3 min) drains from there.
  if (reg.uploaded.length > 0) {
    await admin
      .from("document_queue")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("batch_id", batchId)
      .eq("status", "staged");
    await admin
      .from("document_batches")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", batchId);
  }

  return {
    batchId,
    documentIds: reg.uploaded.map((u) => u.document_id).filter((id): id is string => typeof id === "string"),
  };
}

// ── The fallback loop: chat notification + admin email ─────────────────────

async function notifyNeedsUser(
  admin: Admin,
  orgId: string,
  msg: InboundMessage,
  reason: string,
  deliveryId: string,
) {
  const providerLabel = msg.fromEmail;

  // In-app: assistant message in the owner's most recent chat session (or a
  // dedicated "Provider mail" session) — Realtime delivers it live, and the
  // unread badge surfaces it (same mechanics as pipeline events).
  try {
    const session = await resolveInboundSession(admin, orgId);
    if (session) {
      await admin.from("chat_messages").insert({
        session_id: session,
        role: "assistant",
        content:
          `${providerLabel} sent something I can't fetch automatically` +
          (msg.subject ? ` — "${msg.subject}"` : "") +
          `. Forward it to ${FORWARD_ADDRESS} or upload it here and I'll file it.`,
        metadata: {
          type: "inbound_needs_user",
          inbound_delivery_id: deliveryId,
          sender: msg.fromEmail,
          subject: msg.subject || null,
          reason,
        },
      });
      await admin
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", session);
    }
  } catch (err) {
    console.error("[INBOUND] chat notification failed:", err);
  }

  // Email every admin (compliance-reminders pattern).
  let emailed = false;
  try {
    const emails = await adminEmails(admin);
    const { subject, html } = inboundNeedsYouEmail({
      sender: providerLabel,
      subject: msg.subject || null,
      forwardAddress: FORWARD_ADDRESS,
    });
    for (const to of emails) {
      const res = await sendEmail({ to, subject, html });
      if (!res.error) emailed = true;
    }
  } catch (err) {
    console.error("[INBOUND] email notification failed:", err);
  }

  await admin
    .from("inbound_deliveries")
    .update({
      status: "needs_user",
      reminded_at: emailed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
}

async function resolveInboundSession(admin: Admin, orgId: string): Promise<string | null> {
  const ownerId = await orgOwnerId(admin, orgId);
  if (!ownerId) return null;
  const { data: recent } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("user_id", ownerId)
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) return recent.id as string;
  const { data: created } = await admin
    .from("chat_sessions")
    .insert({ user_id: ownerId, organization_id: orgId, title: "Provider mail" })
    .select("id")
    .single();
  return (created?.id as string) ?? null;
}

async function orgOwnerId(admin: Admin, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string) ?? null;
}

async function adminEmails(admin: Admin): Promise<string[]> {
  const { data: admins } = await admin.from("user_profiles").select("id").eq("role", "admin");
  const ids = (admins || []).map((a) => a.id);
  if (ids.length === 0) return [];
  const { data: { users } } = await admin.auth.admin.listUsers();
  return (users || []).filter((u) => ids.includes(u.id) && u.email).map((u) => u.email!);
}

// ── SafeSend retrieval dispatch ──────────────────────────────────────

/**
 * Run one SafeSend retrieval attempt for a delivery and record the outcome.
 * Called by cron/retrieve-safesend (fresh 'pending' rows) and inline by the
 * poll when the user relays the access code ('waiting_code' resume, seeded).
 */
export async function runSafesendAttempt(
  admin: Admin,
  orgId: string,
  delivery: {
    id: string;
    organization_id: string;
    sender: string;
    subject: string | null;
    safesend_link: string;
    attempts: number;
  },
  seededCode?: string,
): Promise<void> {
  const { retrieveSafesend, nudgeForCode } = await import("./safesend");
  const { data: state } = await admin
    .from("inbound_mail_state")
    .select("mailbox_address")
    .eq("organization_id", orgId)
    .maybeSingle();
  const mailboxAddress = (state?.mailbox_address as string) || FORWARD_ADDRESS;

  if (delivery.attempts >= 2) {
    await admin
      .from("inbound_deliveries")
      .update({ status: "needs_user", needs_user_reason: "safesend retrieval attempts exhausted — download it manually or forward the files", updated_at: new Date().toISOString() })
      .eq("id", delivery.id);
    return;
  }
  await admin
    .from("inbound_deliveries")
    .update({ attempts: delivery.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", delivery.id);

  try {
    const result = await retrieveSafesend(admin, delivery, { mailboxAddress, seededCode });
    if (result.outcome === "retrieved") {
      await admin
        .from("inbound_deliveries")
        .update({ status: "retrieved", batch_id: result.batchId, document_ids: result.documentIds, needs_user_reason: null, updated_at: new Date().toISOString() })
        .eq("id", delivery.id);
      const { data: drow } = await admin.from("inbound_deliveries").select("provider_id").eq("id", delivery.id).maybeSingle();
      await recordInboundOutcome(admin, orgId, "inbound_retrieved", delivery.id, { sender: delivery.sender, files: result.files });
      await autoResolveOpenNudges(admin, orgId, (drow?.provider_id as string) ?? null, delivery.sender, delivery.id);
    } else if (result.outcome === "waiting_code") {
      await admin
        .from("inbound_deliveries")
        .update({ status: "waiting_code", needs_user_reason: `access code sent to ${result.recipient} — forward it to ${mailboxAddress}`, reminded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", delivery.id);
      await nudgeForCode(admin, delivery, result.recipient, mailboxAddress);
      // In-app: same channel as every inbound notification.
      try {
        const session = await resolveInboundSession(admin, orgId);
        if (session) {
          await admin.from("chat_messages").insert({
            session_id: session,
            role: "assistant",
            content: `I'm fetching the documents ${delivery.sender} sent via secure link. SafeSend emailed an access code to ${result.recipient} — forward that email to ${mailboxAddress} and I'll finish up.`,
            metadata: { type: "inbound_needs_user", inbound_delivery_id: delivery.id, sender: delivery.sender, subject: delivery.subject, reason: "waiting_code" },
          });
          await admin.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", session);
        }
      } catch (err) {
        console.error("[SAFESEND] waiting_code chat notify failed:", err);
      }
    } else {
      await admin
        .from("inbound_deliveries")
        .update({ status: "needs_user", needs_user_reason: result.reason, updated_at: new Date().toISOString() })
        .eq("id", delivery.id);
      await notifyNeedsUser(admin, orgId, {
        id: "", threadId: "", internalDate: Date.now(),
        from: delivery.sender, fromEmail: delivery.sender,
        subject: delivery.subject ?? "", snippet: "", bodyText: "", links: [], attachments: [],
      } as InboundMessage, result.reason, delivery.id);
    }
  } catch (err) {
    console.error("[SAFESEND] attempt failed:", err);
    await admin
      .from("inbound_deliveries")
      .update({ status: "needs_user", needs_user_reason: "secure-link retrieval hit an error — download it manually", error: err instanceof Error ? err.message.slice(0, 300) : "unknown", updated_at: new Date().toISOString() })
      .eq("id", delivery.id);
  }
}

/** One retrieval per cron tick: oldest pending safesend delivery. */
export async function processPendingSafesend(): Promise<{ ran: boolean; delivery_id?: string }> {
  const orgId = process.env.INBOUND_ORG_ID;
  if (!orgId || !gmailConfigured()) return { ran: false };
  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("inbound_deliveries")
    .select("id, organization_id, sender, subject, safesend_link, safesend_links, attempts")
    .eq("organization_id", orgId)
    .eq("classification", "safesend")
    .eq("status", "pending")
    .not("safesend_link", "is", null)
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pending) return { ran: false };
  await runSafesendAttempt(admin, orgId, pending as never);
  return { ran: true, delivery_id: pending.id as string };
}

// ── Increment 3: outcome audit, auto-resolve, purge, failed retry ────

/** Done-lane entry (audit log; humanized by activity-humanizer). */
async function recordInboundOutcome(
  admin: Admin,
  orgId: string,
  action: "inbound_filed" | "inbound_retrieved" | "inbound_auto_resolved",
  deliveryId: string,
  metadata: Record<string, unknown>,
) {
  try {
    const { logAuditEvent } = await import("@/lib/utils/audit");
    await logAuditEvent({
      userId: await orgOwnerId(admin, orgId),
      action,
      resourceType: "inbound_delivery",
      resourceId: deliveryId,
      metadata: { ...metadata, actor: "rhodes" },
      organizationId: orgId,
    });
  } catch (err) {
    console.error("[INBOUND] audit record failed:", err);
  }
}

/**
 * Auto-resolve (spec §1a): a document arriving from a provider/sender clears
 * that provider's open nudges — resolution is the document arriving, never a
 * click. Matches by provider when known, else sender domain, 30-day window.
 */
export async function autoResolveOpenNudges(
  admin: Admin,
  orgId: string,
  providerId: string | null,
  senderEmail: string,
  causeDeliveryId: string,
) {
  try {
    const domain = senderEmail.split("@").pop()?.toLowerCase() ?? "";
    const q = admin
      .from("inbound_deliveries")
      .select("id, sender, provider_id")
      .eq("organization_id", orgId)
      .in("status", ["needs_user", "acknowledged", "waiting_code"])
      .neq("id", causeDeliveryId)
      .gte("received_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString());
    const { data: open } = await q;
    const matches = (open ?? []).filter((r) =>
      providerId && r.provider_id ? r.provider_id === providerId : (r.sender ?? "").toLowerCase().endsWith("@" + domain),
    );
    for (const m of matches) {
      await admin
        .from("inbound_deliveries")
        .update({ status: "resolved", updated_at: new Date().toISOString() })
        .eq("id", m.id);
      await recordInboundOutcome(admin, orgId, "inbound_auto_resolved", m.id as string, { resolved_by_delivery: causeDeliveryId });
    }
  } catch (err) {
    console.error("[INBOUND] auto-resolve failed:", err);
  }
}

/** 30-day skipped-mail purge (spec §3d): ignored rows shrink to the dedup stub. */
export async function purgeIgnoredMetadata(admin: Admin, orgId: string) {
  try {
    await admin
      .from("inbound_deliveries")
      .update({ sender: null, subject: null, needs_user_reason: null, error: null })
      .eq("organization_id", orgId)
      .eq("status", "ignored")
      .not("sender", "is", null)
      .lt("received_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString());
  } catch (err) {
    console.error("[INBOUND] ignored purge failed:", err);
  }
}

/** One automatic retry for failed rows (field finding: failures were terminal). */
export async function retryFailedDeliveries(admin: Admin, orgId: string, result: InboundRunResult) {
  const { data: failed } = await admin
    .from("inbound_deliveries")
    .select("id, gmail_message_id, attempts")
    .eq("organization_id", orgId)
    .eq("status", "failed")
    .eq("attempts", 0)
    .gte("received_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
    .limit(3);
  for (const row of failed ?? []) {
    const { getMessage } = await import("./gmail");
    const msg = await getMessage(row.gmail_message_id as string);
    await admin
      .from("inbound_deliveries")
      .update({ attempts: 1, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!msg) continue;
    try {
      // Fresh dispatch against the SAME row: delete + re-handle (the unique
      // gmail_message_id makes re-insertion clean).
      await admin.from("inbound_deliveries").delete().eq("id", row.id);
      await handleMessage(admin, orgId, msg, result);
      await admin
        .from("inbound_deliveries")
        .update({ attempts: 1, updated_at: new Date().toISOString() })
        .eq("gmail_message_id", row.gmail_message_id);
    } catch (err) {
      console.error("[INBOUND] retry failed:", err);
    }
  }
}
