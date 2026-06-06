/**
 * Provider document-send service (Phase 1 routing hub).
 *
 * This is the side-effectful counterpart to apply.ts: it touches Storage
 * (download the file) and email (send it), which apply.ts deliberately does
 * not. Both front doors — POST /api/documents/[id]/send and the
 * send_document_to_provider MCP tool — are thin wrappers over this one
 * function, so send parity lives here (the analog of apply.ts for data writes).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getSecureDelivery } from "@/lib/providers/secure-delivery";
import { recordRoutingDecision } from "@/lib/providers/routing-rules";
import { logAuditEvent } from "@/lib/utils/audit";
import type { ProviderContact, ProviderDocumentSend } from "@/lib/types/entities";

export interface SendDocumentInput {
  document_id: string;
  provider_id: string;
  recipient_email?: string | null;
  subject?: string | null;
  message?: string | null;
}

export interface SendDocumentCtx {
  orgId: string;
  userId: string | null;
  /** Acting user's email — used for reply-to + CC. Resolved from userId if omitted. */
  userEmail?: string | null;
}

export class SendDocumentError extends Error {
  code: "not_found" | "no_recipient" | "download_failed";
  constructor(code: SendDocumentError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SendDocumentError";
  }
}

/** Resolve the recipient: explicit arg → provider.default_contact_email → first is_default contact. */
function resolveRecipient(
  explicit: string | null | undefined,
  defaultEmail: string | null,
  contacts: ProviderContact[],
): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  if (defaultEmail && defaultEmail.trim()) return defaultEmail.trim();
  const dflt = contacts.find((c) => c.is_default && c.email?.trim());
  if (dflt) return dflt.email.trim();
  const first = contacts.find((c) => c.email?.trim());
  return first ? first.email.trim() : null;
}

async function resolveUserEmail(
  admin: ReturnType<typeof createAdminClient>,
  userId: string | null,
  provided: string | null | undefined,
): Promise<string | null> {
  if (provided && provided.trim()) return provided.trim();
  if (!userId) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function sendDocumentToProvider(
  input: SendDocumentInput,
  ctx: SendDocumentCtx,
): Promise<{ data: ProviderDocumentSend }> {
  const admin = createAdminClient();

  // 1. Verify document + provider both belong to the org (and aren't deleted).
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .select("id, name, file_path, mime_type, entity_id, organization_id, document_type")
    .eq("id", input.document_id)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!doc) throw new SendDocumentError("not_found", "Document not found");

  const { data: provider, error: provErr } = await admin
    .from("service_providers")
    .select("id, name, default_contact_email, contacts")
    .eq("id", input.provider_id)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (provErr) throw provErr;
  if (!provider) throw new SendDocumentError("not_found", "Provider not found");

  // 2. Resolve recipient.
  const recipient = resolveRecipient(
    input.recipient_email,
    provider.default_contact_email,
    (provider.contacts as ProviderContact[]) ?? [],
  );
  if (!recipient) {
    throw new SendDocumentError(
      "no_recipient",
      `No recipient email for provider "${provider.name}" — pass one explicitly or set a default contact.`,
    );
  }

  const senderEmail = await resolveUserEmail(admin, ctx.userId, ctx.userEmail);
  const subject = input.subject?.trim() || `${doc.name} — shared via Rhodes`;

  // 3. Insert the send row as queued.
  const { data: sendRow, error: insErr } = await admin
    .from("provider_document_sends")
    .insert({
      organization_id: ctx.orgId,
      provider_id: provider.id,
      document_id: doc.id,
      entity_id: doc.entity_id,
      recipient_email: recipient,
      subject,
      message: input.message?.trim() || null,
      status: "queued",
      sent_by: ctx.userId,
    })
    .select()
    .single();
  if (insErr) throw insErr;

  // 4. Hand the file to the configured secure-delivery impl — a secure,
  // expiring link (or vendor package). NEVER a plaintext email attachment (these
  // documents carry PII). Bytes are fetched lazily: the Rhodes-link path serves
  // the file at access time and never downloads here.
  const senderName = senderEmail ? senderEmail.split("@")[0] : "Rhodes";
  const getFileBuffer = async (): Promise<Buffer> => {
    const { data: fileData, error: dlErr } = await admin.storage
      .from("documents")
      .download(doc.file_path);
    if (dlErr || !fileData) {
      throw new SendDocumentError("download_failed", `Failed to download document: ${dlErr?.message ?? "no data"}`);
    }
    return Buffer.from(await (fileData as Blob).arrayBuffer());
  };

  const delivery = await getSecureDelivery().send({
    getFileBuffer,
    filename: doc.name,
    mimeType: doc.mime_type ?? "application/octet-stream",
    recipientEmail: recipient,
    senderName,
    providerName: provider.name,
    subject,
    message: input.message ?? undefined,
    replyTo: senderEmail ?? undefined,
  });

  // 5. Record the outcome (including the share token + expiry on the link path).
  const nowIso = new Date().toISOString();
  const updates =
    delivery.status === "sent"
      ? {
          status: "sent" as const,
          delivery_provider: delivery.provider,
          delivery_ref: delivery.ref || null,
          share_token: delivery.share_token ?? null,
          expires_at: delivery.expires_at ?? null,
          sent_at: nowIso,
        }
      : {
          status: "failed" as const,
          delivery_provider: delivery.provider,
          delivery_ref: delivery.ref || null,
          share_token: delivery.share_token ?? null,
          expires_at: delivery.expires_at ?? null,
          error: delivery.error ?? "secure delivery failed",
          sent_at: nowIso,
        };

  const { data: finalRow, error: updErr } = await admin
    .from("provider_document_sends")
    .update(updates)
    .eq("id", sendRow.id)
    .select()
    .single();
  if (updErr) throw updErr;

  // 7. Audit.
  await logAuditEvent({
    userId: ctx.userId,
    action: "send",
    resourceType: "provider_document_send",
    resourceId: finalRow.id,
    entityId: doc.entity_id,
    organizationId: ctx.orgId,
    metadata: {
      provider_id: provider.id,
      provider_name: provider.name,
      document_name: doc.name,
      recipient_email: recipient,
      status: finalRow.status,
      delivery_provider: delivery.provider,
    },
  });

  // 8. Learn the routing decision: the user chose to route this document type to
  // this provider. The signal is the decision itself, independent of whether the
  // delivery succeeded — so record it regardless of delivery.status. Best-effort.
  await recordRoutingDecision(admin, ctx.orgId, doc.document_type, provider.id);

  return { data: finalRow as ProviderDocumentSend };
}
