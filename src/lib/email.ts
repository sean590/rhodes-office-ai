import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = process.env.EMAIL_FROM || "Rhodes <noreply@notify.rhodesoffice.ai>";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
    const client = getResend();
    if (!client) {
      console.warn("[EMAIL] RESEND_API_KEY not set, skipping email");
      return;
    }
    const { error } = await client.emails.send({
      from: FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    if (error) console.error("[EMAIL] Send failed:", error);
  } catch (err) {
    console.error("[EMAIL] Error:", err);
    // Never throw — email failures shouldn't block primary operations
  }
}
