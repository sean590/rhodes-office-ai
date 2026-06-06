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
