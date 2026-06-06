import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = process.env.EMAIL_FROM || "Rhodes <noreply@notify.rhodesoffice.ai>";

export interface SendEmailResult {
  id?: string;
  error?: string;
}

// NOTE: deliberately no `attachments` param. Documents to providers carry PII
// and go out via the secure-delivery vendor (see secure-delivery.ts), never as
// a plaintext email attachment. sendEmail is for notifications and cover notes
// only — context, not files.
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string | string[];
}): Promise<SendEmailResult> {
  try {
    const client = getResend();
    if (!client) {
      console.warn("[EMAIL] RESEND_API_KEY not set, skipping email");
      return { error: "email_not_configured" };
    }
    const { data, error } = await client.emails.send({
      from: FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      ...(params.cc ? { cc: params.cc } : {}),
    });
    if (error) {
      console.error("[EMAIL] Send failed:", error);
      return { error: error.message || "send_failed" };
    }
    return { id: data?.id };
  } catch (err) {
    console.error("[EMAIL] Error:", err);
    // Never throw — email failures shouldn't block primary operations. Callers
    // that care (e.g. provider sends) inspect the returned error.
    return { error: err instanceof Error ? err.message : "send_error" };
  }
}
