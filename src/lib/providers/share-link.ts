/**
 * Shared validation + access-logging for the public secure-link share surface.
 * Used by both the share page and the download API. Server-only (admin client).
 *
 * Validation is enforced on EVERY access (not just at render): the token must
 * exist, be unrevoked, unexpired, and belong to a non-failed send. All failure
 * modes collapse to "not found" — callers must show one generic message and
 * never reveal which condition failed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ValidShareSend {
  id: string;
  organization_id: string;
  document_id: string;
  provider_id: string;
  subject: string | null;
  message: string | null;
  sent_by: string | null;
  status: string;
  share_token: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export async function lookupValidSend(
  admin: SupabaseClient,
  token: string | undefined,
): Promise<ValidShareSend | null> {
  if (!token) return null;
  const { data } = await admin
    .from("provider_document_sends")
    .select("id, organization_id, document_id, provider_id, subject, message, sent_by, status, share_token, expires_at, revoked_at")
    .eq("share_token", token)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.status === "failed") return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as ValidShareSend;
}

/**
 * A provider-facing label for who shared the document. Prefers the acting
 * user's display name, then the organization (family-office) name. Returns null
 * if neither resolves — callers should fall back to "Shared with you via Rhodes"
 * rather than ever printing "Rhodes via Rhodes".
 */
export async function resolveSenderLabel(
  admin: SupabaseClient,
  sentBy: string | null,
  orgId: string,
): Promise<string | null> {
  if (sentBy) {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("display_name")
      .eq("id", sentBy)
      .maybeSingle();
    if (prof?.display_name?.trim()) return prof.display_name.trim();
  }
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  return org?.name?.trim() || null;
}

export interface SendDocument {
  id: string;
  name: string;
  file_path: string;
}

/**
 * The documents in a send bundle (from the join table; falls back to the send's
 * primary document_id for any legacy single-doc row). Order is not guaranteed.
 */
export async function getSendDocuments(
  admin: SupabaseClient,
  send: ValidShareSend,
): Promise<SendDocument[]> {
  const { data: links } = await admin
    .from("provider_document_send_documents")
    .select("document_id")
    .eq("send_id", send.id);
  let docIds = (links ?? []).map((l) => l.document_id as string);
  if (docIds.length === 0 && send.document_id) docIds = [send.document_id];
  if (docIds.length === 0) return [];
  const { data: docs } = await admin
    .from("documents")
    .select("id, name, file_path")
    .in("id", docIds);
  return (docs ?? []) as SendDocument[];
}

export async function logSendAccess(
  admin: SupabaseClient,
  send: ValidShareSend,
  action: "viewed" | "downloaded",
  meta: { claimedEmail?: string | null; ip?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    await admin.from("provider_document_send_access").insert({
      organization_id: send.organization_id,
      send_id: send.id,
      action,
      claimed_email: meta.claimedEmail ?? null,
      ip_address: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
    });
  } catch (err) {
    console.error("[share] logSendAccess failed:", err);
  }
}
