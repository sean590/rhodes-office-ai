import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || "Rhodes <noreply@notify.rhodesoffice.ai>";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
    const { error } = await resend.emails.send({
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
