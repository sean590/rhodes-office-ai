/**
 * Secure document delivery (Phase 1 routing hub).
 *
 * Documents Rhodes sends to providers (K-1s, returns, financials) carry PII —
 * SSNs, EINs, account numbers. They are NOT sent as plaintext email
 * attachments; firms' security policies reject that and it's the whole reason
 * they use SafeSend/Extranet. Instead they go out as a secure, expiring,
 * recipient-verified link via a third-party secure-delivery vendor.
 *
 * This is the vendor-agnostic seam. The send service (send-document.ts) depends
 * only on the `SecureDelivery` interface; the concrete impl is selected by the
 * `SECURE_DELIVERY_PROVIDER` env var. SendSafely is the intended default; Box
 * and a future `rhodes_native` (Supabase signed URL + OTP) are drop-in swaps.
 *
 * Fail-safe: if no provider is configured, delivery returns `status: "failed"`.
 * There is deliberately NO plaintext-attachment fallback — an unconfigured
 * system must never silently email PII.
 */

import { randomBytes } from "crypto";
import { sendEmail } from "@/lib/email";
import { documentDeliveryEmail } from "@/lib/email-templates";

export interface SecureDeliveryFile {
  filename: string;
  mimeType: string;
  /** Lazily fetch the bytes — impls that don't need them at send time (the
   *  Rhodes link path serves files at access time) never call this. */
  getBuffer: () => Promise<Buffer>;
}

export interface SecureDeliveryInput {
  /** One or more documents bundled into a single secure delivery. */
  documents: SecureDeliveryFile[];
  recipientEmail: string;
  senderName: string;
  providerName: string;
  subject?: string;
  message?: string;
  /** Acting user's address — used as reply-to / CC on any notification. */
  replyTo?: string;
}

export interface SecureDeliveryResult {
  /** Which impl handled it — stored in provider_document_sends.delivery_provider. */
  provider: string;
  /** Vendor package / secure-link id — stored in delivery_ref. NEVER the live URL. */
  ref: string;
  status: "sent" | "failed";
  error?: string;
  /** Rhodes-link path only: the capability token + its expiry, persisted on the send row. */
  share_token?: string;
  expires_at?: string;
}

export interface SecureDelivery {
  send(input: SecureDeliveryInput): Promise<SecureDeliveryResult>;
}

/**
 * Fail-safe default. Selected whenever SECURE_DELIVERY_PROVIDER is unset or
 * unknown. Never sends — records a clear failure so the send row reflects that
 * secure delivery isn't configured, rather than falling back to plain email.
 */
class UnconfiguredSecureDelivery implements SecureDelivery {
  async send(): Promise<SecureDeliveryResult> {
    return {
      provider: "unconfigured",
      ref: "",
      status: "failed",
      error:
        "Secure delivery is not configured. Set SECURE_DELIVERY_PROVIDER (e.g. 'sendsafely') and the vendor credentials.",
    };
  }
}

/**
 * SendSafely adapter — the intended default. Purpose-built secure file exchange
 * with an API, expiring links, and recipient verification (client-side
 * encryption). Requires a SendSafely account + API key/secret; the full
 * encrypt→upload→add-recipient→finalize flow is wired once those exist.
 *
 * Until then, selecting it without credentials fails safe with a clear message
 * — the rest of the system (route, MCP tool, UI, audit) is already ready.
 */
class SendSafelyDelivery implements SecureDelivery {
  async send(input: SecureDeliveryInput): Promise<SecureDeliveryResult> {
    const apiKey = process.env.SENDSAFELY_API_KEY;
    const apiSecret = process.env.SENDSAFELY_API_SECRET;
    const host = process.env.SENDSAFELY_HOST;
    if (!apiKey || !apiSecret || !host) {
      return {
        provider: "sendsafely",
        ref: "",
        status: "failed",
        error: "SendSafely is selected but not configured (SENDSAFELY_API_KEY / API_SECRET / HOST).",
      };
    }
    // TODO(secure-delivery): implement the SendSafely package flow once an
    // account exists — create package, await input.getFileBuffer(), client-side-
    // encrypt + upload, add input.recipientEmail as a recipient, finalize, return
    // the package id in `ref`. Until then we fail closed rather than risk an
    // insecure send.
    void input;
    return {
      provider: "sendsafely",
      ref: "",
      status: "failed",
      error: "SendSafely adapter not yet implemented.",
    };
  }
}

/**
 * Rhodes-native secure link (no OTP). The file stays in Supabase storage; the
 * provider gets an email with a link to a Rhodes share page that logs access and
 * mints a short-lived signed URL. The token is the capability — unguessable,
 * expiring, revocable. No bytes are fetched at send time.
 * See rhodes-secure-link-delivery-mini-spec.md.
 */
class RhodesLinkDelivery implements SecureDelivery {
  async send(input: SecureDeliveryInput): Promise<SecureDeliveryResult> {
    const token = randomBytes(32).toString("base64url");
    const days = parseInt(process.env.SHARE_LINK_EXPIRY_DAYS || "14", 10) || 14;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const base = process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai";
    const shareUrl = `${base.replace(/\/$/, "")}/share/${token}`;

    const documentNames = input.documents.map((d) => d.filename);
    const html = documentDeliveryEmail({
      providerName: input.providerName,
      senderName: input.senderName,
      documentNames,
      message: input.message,
      shareUrl,
    });

    const subject =
      input.subject ||
      (documentNames.length === 1
        ? `${documentNames[0]} — shared via Rhodes`
        : `${documentNames.length} documents — shared via Rhodes`);
    const result = await sendEmail({
      to: input.recipientEmail,
      subject,
      html,
      ...(input.replyTo ? { replyTo: input.replyTo, cc: input.replyTo } : {}),
    });

    if (result.error) {
      return {
        provider: "rhodes_link",
        ref: token,
        status: "failed",
        error: result.error,
        share_token: token,
        expires_at: expiresAt,
      };
    }
    return {
      provider: "rhodes_link",
      ref: token,
      status: "sent",
      share_token: token,
      expires_at: expiresAt,
    };
  }
}

let cached: SecureDelivery | null = null;

/**
 * Resolve the configured SecureDelivery impl. Cached per process.
 */
export function getSecureDelivery(): SecureDelivery {
  if (cached) return cached;
  const provider = (process.env.SECURE_DELIVERY_PROVIDER || "").toLowerCase();
  switch (provider) {
    case "rhodes_link":
    case "rhodes_native":
      cached = new RhodesLinkDelivery();
      break;
    case "sendsafely":
      cached = new SendSafelyDelivery();
      break;
    // case "box":  // drop-in: BoxDelivery
    default:
      cached = new UnconfiguredSecureDelivery();
      break;
  }
  return cached;
}

/** Test seam — override the impl (and reset with null). */
export function __setSecureDeliveryForTests(impl: SecureDelivery | null): void {
  cached = impl;
}
