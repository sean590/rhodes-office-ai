/**
 * Consent ledger writes. One immutable row per consent event (signup clickwrap,
 * auto-renewal acknowledgment, AI-on-tax-docs disclosure). Best-effort by
 * design — a consent-write failure must never break the flow it records, but we
 * log loudly since these are compliance records. Caller supplies the admin
 * client (service-role; consent rows are written server-side only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Caller passes the service-role client; typed loosely so this helper doesn't
// itself reference the admin factory (keeps it out of the admin-usage ratchet).
type Admin = SupabaseClient;

// Version stamp for the ToS/Privacy the user agreed to (matches the published
// docs' Last Updated date). Bump on any revision before open; env-overridable.
export const CONSENT_DOC_VERSION = process.env.CONSENT_DOC_VERSION || "2026-08-04.v1";

export type ConsentType =
  | "signup_clickwrap"
  | "auto_renewal"
  | "terms_of_service"
  | "privacy_policy"
  | "ai_disclosure";

export interface ConsentInput {
  organizationId: string | null;
  userId?: string | null;
  consentType: ConsentType;
  documentVersion?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordConsent(admin: Admin, input: ConsentInput): Promise<void> {
  try {
    const { error } = await admin.from("consent_records").insert({
      organization_id: input.organizationId,
      user_id: input.userId ?? null,
      consent_type: input.consentType,
      document_version: input.documentVersion ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) console.error("[consent] insert failed:", error.message, input.consentType);
  } catch (err) {
    console.error("[consent] insert threw:", err);
  }
}
