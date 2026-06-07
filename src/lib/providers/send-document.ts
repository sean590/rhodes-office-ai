/**
 * Provider document-send service (Phase 1 routing hub).
 *
 * A send is a BUNDLE: one or more documents share one secure link (one token,
 * expiry, recipient, email). This is the side-effectful counterpart to apply.ts
 * (Storage + email), which apply.ts deliberately avoids. The route
 * (POST /api/provider-sends) and the send_document_to_provider MCP tool are thin
 * wrappers over this one function — send parity lives here.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getSecureDelivery } from "@/lib/providers/secure-delivery";
import { resolveSenderLabel } from "@/lib/providers/share-link";
import { recordRoutingDecision } from "@/lib/providers/routing-rules";
import { logAuditEvent } from "@/lib/utils/audit";
import type { ProviderContact, ProviderDocumentSend } from "@/lib/types/entities";

export interface SendDocumentInput {
  /** One or more documents to bundle into a single secure link. */
  document_ids: string[];
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

  const ids = [...new Set((input.document_ids ?? []).filter(Boolean))];
  if (ids.length === 0) throw new SendDocumentError("not_found", "No documents selected");

  // 1. Verify ALL documents belong to the org (and aren't deleted). Preserve the
  // caller's order; documents[0] is the "primary" (drives entity_id + display).
  const { data: docRows, error: docErr } = await admin
    .from("documents")
    .select("id, name, file_path, mime_type, entity_id, organization_id, document_type")
    .in("id", ids)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null);
  if (docErr) throw docErr;
  const byId = new Map((docRows ?? []).map((d) => [d.id, d]));
  const docs = ids.map((id) => byId.get(id)).filter(Boolean) as NonNullable<typeof docRows>;
  if (docs.length !== ids.length) {
    throw new SendDocumentError("not_found", "One or more documents not found");
  }
  const primary = docs[0];

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
  const subject =
    input.subject?.trim() ||
    (docs.length === 1 ? `${primary.name} — shared via Rhodes` : `${docs.length} documents — shared via Rhodes`);

  // 3. Insert the send (bundle) row as queued; document_id = primary for compat.
  const { data: sendRow, error: insErr } = await admin
    .from("provider_document_sends")
    .insert({
      organization_id: ctx.orgId,
      provider_id: provider.id,
      document_id: primary.id,
      entity_id: primary.entity_id,
      recipient_email: recipient,
      subject,
      message: input.message?.trim() || null,
      status: "queued",
      sent_by: ctx.userId,
    })
    .select()
    .single();
  if (insErr) throw insErr;

  // Everything past the queued insert is wrapped: any throw marks the row
  // `failed` and returns it gracefully — never a 500 with an orphaned `queued`.
  try {
    // Record the bundle contents.
    const { error: bundleErr } = await admin.from("provider_document_send_documents").insert(
      docs.map((d) => ({ organization_id: ctx.orgId, send_id: sendRow.id, document_id: d.id })),
    );
    if (bundleErr) throw bundleErr;

    // Provider-facing sender label: person's name → org (family office) name →
    // email local-part. Never the bare app name.
    const senderName =
      (await resolveSenderLabel(admin, ctx.userId, ctx.orgId)) ||
      (senderEmail ? senderEmail.split("@")[0] : "your client");

    // Hand the bundle to the configured secure-delivery impl. Bytes are fetched
    // lazily per file: the Rhodes-link path serves each file at access time and
    // never downloads here.
    const documents = docs.map((d) => ({
      filename: d.name,
      mimeType: d.mime_type ?? "application/octet-stream",
      getBuffer: async (): Promise<Buffer> => {
        const { data: fileData, error: dlErr } = await admin.storage.from("documents").download(d.file_path);
        if (dlErr || !fileData) {
          throw new SendDocumentError("download_failed", `Failed to download "${d.name}": ${dlErr?.message ?? "no data"}`);
        }
        return Buffer.from(await (fileData as Blob).arrayBuffer());
      },
    }));

    const delivery = await getSecureDelivery().send({
      documents,
      recipientEmail: recipient,
      senderName,
      providerName: provider.name,
      subject,
      message: input.message ?? undefined,
      replyTo: senderEmail ?? undefined,
    });

    // Record the outcome (incl. share token + expiry on the link path).
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

    // Audit.
    await logAuditEvent({
      userId: ctx.userId,
      action: "send",
      resourceType: "provider_document_send",
      resourceId: finalRow.id,
      entityId: primary.entity_id,
      organizationId: ctx.orgId,
      metadata: {
        provider_id: provider.id,
        provider_name: provider.name,
        document_names: docs.map((d) => d.name),
        recipient_email: recipient,
        status: finalRow.status,
        delivery_provider: delivery.provider,
      },
    });

    // Learn the routing decision per document type → provider (best-effort).
    const learnedTypes = new Set<string>();
    for (const d of docs) {
      if (d.document_type && !learnedTypes.has(d.document_type)) {
        learnedTypes.add(d.document_type);
        await recordRoutingDecision(admin, ctx.orgId, d.document_type, provider.id);
      }
    }

    return { data: finalRow as ProviderDocumentSend };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    const { data: failedRow } = await admin
      .from("provider_document_sends")
      .update({ status: "failed", error: message, sent_at: new Date().toISOString() })
      .eq("id", sendRow.id)
      .select()
      .single();
    return { data: (failedRow ?? { ...sendRow, status: "failed", error: message }) as ProviderDocumentSend };
  }
}
