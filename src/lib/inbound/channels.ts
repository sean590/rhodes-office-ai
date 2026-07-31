/**
 * Inbound channels — the multi-tenancy backbone (migration 080,
 * rhodes-inbound-multitenancy-plan.md). One row per org says HOW mail reaches
 * it; all channel types feed the same triage → ingest → SafeSend pipeline.
 *
 *   rhodes_hosted    Plan A — a unique unguessable address on in.rhodesoffice.ai,
 *                    received via Resend Inbound webhook (push).
 *   google_oauth     Plan B — a customer's dedicated mailbox read via API.
 *   microsoft_oauth  (later)
 *
 * This replaces the single-tenant INBOUND_ORG_ID env constant. The pure helpers
 * (address generation + recipient normalization) are unit-tested; the DB helpers
 * resolve/seed channels for the worker.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// These helpers run under the service-role admin client passed in by the
// worker/webhook; they never construct one, so we take the SupabaseClient type
// directly (keeps the admin-ratchet count honest).
type Admin = SupabaseClient;

export type ChannelType = "rhodes_hosted" | "google_oauth" | "microsoft_oauth";

export type InboundChannel = {
  id: string;
  organization_id: string;
  type: ChannelType;
  address: string | null;
  recipient_token: string | null;
  status: "active" | "pending" | "revoked" | "error";
  credentials_ref: string | null;
};

/** Domain that Plan A hosted addresses live on (MX → Resend). */
export const HOSTED_DOMAIN = process.env.INBOUND_HOSTED_DOMAIN || "docs.rhodesoffice.ai";

// ── Pure helpers (unit-tested) ───────────────────────────────────────────

const SLUG_MAX = 24;

/** Lowercase, keep [a-z0-9], collapse the rest to single hyphens. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * Generate a unique, UNGUESSABLE hosted address. The token carries 80 bits of
 * entropy (base32, 16 chars) so addresses can't be enumerated by guessing an
 * org name — a friendly slug is prefixed only for human readability, never for
 * routing (routing matches the full address). `randomBytes` varies per call.
 */
export function generateInboundAddress(label?: string): {
  address: string;
  localPart: string;
  recipientToken: string;
} {
  // base32 (Crockford-ish, lowercase, no padding) — email-safe, unambiguous.
  const token = base32(randomBytes(10)); // 10 bytes → 16 chars
  const slug = label ? slugify(label) : "";
  const localPart = slug ? `${slug}-${token}` : token;
  return { address: `${localPart}@${HOSTED_DOMAIN}`, localPart, recipientToken: token };
}

function base32(buf: Buffer): string {
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Normalize an inbound recipient for matching: pull the address out of a
 * "Name <addr>" form, lowercase, and strip any +tag (sub-addressing) so
 * `smith-x+anything@dom` still resolves to `smith-x@dom`.
 */
export function normalizeRecipient(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return addr;
  const local = addr.slice(0, at).split("+")[0];
  return `${local}@${addr.slice(at + 1)}`;
}

// ── DB helpers ───────────────────────────────────────────────────────────

/**
 * Resolve which org a hosted-address inbound message belongs to. Matches the
 * normalized recipient against a channel's stored address. Returns null when no
 * active hosted channel owns the address (caller drops / logs).
 */
export async function resolveOrgByRecipient(
  admin: Admin,
  recipient: string,
): Promise<{ orgId: string; channelId: string } | null> {
  const normalized = normalizeRecipient(recipient);
  const { data } = await admin
    .from("inbound_channels")
    .select("id, organization_id")
    .eq("type", "rhodes_hosted")
    .eq("status", "active")
    .ilike("address", normalized)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.organization_id as string, channelId: data.id as string };
}

/** Active mailbox-poll channels (oauth types) for the retrieval sweep. */
export async function listActivePollChannels(admin: Admin): Promise<InboundChannel[]> {
  const { data } = await admin
    .from("inbound_channels")
    .select("id, organization_id, type, address, recipient_token, status, credentials_ref")
    .eq("status", "active")
    .in("type", ["google_oauth", "microsoft_oauth"]);
  return (data ?? []) as InboundChannel[];
}

/**
 * Backward-compat bridge: represent the legacy single mailbox (Rhodes@channels
 * .com via GMAIL_* env vars, destined for INBOUND_ORG_ID) as one google_oauth
 * channel with credentials_ref='env'. Idempotent — the unique (org,type,
 * address) index makes a repeat insert a no-op. Lets the worker read channels
 * as the source of truth while prod keeps working unchanged.
 */
export async function ensureLegacyGoogleChannel(
  admin: Admin,
  orgId: string,
  mailboxAddress: string | null,
): Promise<void> {
  const address = (mailboxAddress || "rhodes@channels.com").toLowerCase();
  await admin
    .from("inbound_channels")
    .upsert(
      {
        organization_id: orgId,
        type: "google_oauth",
        address,
        status: "active",
        credentials_ref: "env",
        label: "Rhodes mailbox",
      },
      { onConflict: "organization_id,type,address" },
    );
}

/** Stable id for a hosted address (dedupe/idempotency helper, if needed). */
export function addressFingerprint(address: string): string {
  return createHash("sha256").update(normalizeRecipient(address)).digest("hex").slice(0, 16);
}
