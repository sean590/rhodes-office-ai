/**
 * Edge Function: waitlist-welcome (v2 — apply-form triage)
 *
 * Fired by the existing Database Webhook on INSERT into public.waitlist.
 * Replaces the survey-link email with a triage branch:
 *
 *   - Record has apply-form fields + QUALIFIES  → early-access invite (reply to schedule)
 *   - Record has apply-form fields + doesn't    → warm waitlist note
 *   - Record has NO apply-form fields           → warm waitlist note too (the apply form
 *                                                 replaced the old Google-form survey;
 *                                                 bare signups, e.g. from /family-office,
 *                                                 still get an acknowledgment)
 *
 * Triage rule (keep in sync with the waitlist_qualified view in
 * supabase/migrations/072_waitlist_apply_form.sql): 5+ entities OR any trust
 * OR (LP stakes AND 3+ entities).
 *
 * Deploy (replaces v1 in place — same function name, same webhook, same secrets):
 *   supabase functions deploy waitlist-welcome --no-verify-jwt
 *
 * Optional: set CALENDAR_URL below to a scheduling link to swap the reply-to-schedule
 * ask for a booking button in the invite email.
 */

const CALENDAR_URL = ""; // optional: e.g. a cal.com/calendly link; empty = ask to reply

const FROM = "Sean at Rhodes <sean@notify.rhodesoffice.ai>";
const REPLY_TO = "sean@rhodesoffice.ai";

type WaitlistRecord = {
  email?: string;
  utm_source?: string | null;
  entity_count?: string | null;
  asset_mix?: string | null;
  tracking_method?: string | null;
};

function isQualified(r: WaitlistRecord): boolean {
  const count = r.entity_count ?? "";
  const mix = r.asset_mix ?? "";
  const fivePlus = ["5-9", "10-24", "25+"].includes(count);
  const threePlus = ["3-4", "5-9", "10-24", "25+"].includes(count);
  return fivePlus || mix.includes("trusts") || (mix.includes("lp_stakes") && threePlus);
}

const wrap = (inner: string): string => `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.55; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px 16px;">
    <img src="https://www.rhodesoffice.ai/email-logo.png" alt="Rhodes" width="140" height="41" style="display: block; margin-bottom: 28px; border: 0;" />
    ${inner}
    <p>Sean<br/>Founder, Rhodes<br/><a href="https://rhodesoffice.ai" style="color: #1a1a1a;">rhodesoffice.ai</a></p>
  </body>
</html>`;

// ── Invite (qualified) ───────────────────────────────────────────────
const INVITE_SUBJECT = "Rhodes early access — you're in, let's set it up";

function inviteText(): string {
  const scheduling = CALENDAR_URL
    ? `Grab a time here and we'll get you set up: ${CALENDAR_URL}`
    : `Just reply to this email with a couple of times that work this week and I'll get you set up.`;
  return `Hi,

Thanks for applying for the Rhodes beta. Based on what you told me about your setup, you're exactly who I'm building this for — so let's skip the line.

The beta is free, it's a small group, and you get a direct line to me. In return I want your honest reaction to rough edges.

${scheduling}

Sean
Founder, Rhodes
rhodesoffice.ai`;
}

function inviteHtml(): string {
  const scheduling = CALENDAR_URL
    ? `<p style="margin: 28px 0;"><a href="${CALENDAR_URL}" style="background: #1a1a1a; color: #ffffff; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600;">Pick a time</a></p>`
    : `<p><strong>Just reply to this email</strong> with a couple of times that work this week and I'll get you set up.</p>`;
  return wrap(`<p>Hi,</p>
    <p>Thanks for applying for the <strong>Rhodes</strong> beta. Based on what you told me about your setup, you're exactly who I'm building this for &mdash; so let's skip the line.</p>
    <p>The beta is free, it's a small group, and you get a direct line to me. In return I want your honest reaction to rough edges.</p>
    ${scheduling}`);
}

// ── Waitlist note (not qualified) ────────────────────────────────────
const WAITLIST_SUBJECT = "You're on the Rhodes waitlist";

// hasAnswers: apply-form signups get "based on your answers" and the
// situation-changed reply hook; bare signups (e.g. /family-office) answered
// nothing — for them the closing is an explicit reply-to-qualify ask, the
// mechanism that converts a bare email into a qualified lead.
function waitlistText(hasAnswers: boolean): string {
  const placement = hasAnswers
    ? "Based on your answers I've put you on the waitlist rather than in the first wave."
    : "For now I've put you on the waitlist.";
  const closing = hasAnswers
    ? "You'll hear from me as the group expands. If your situation gets more complicated before then (it usually does), reply here and tell me — that moves you up."
    : "You'll hear from me as the group expands. Want to move up? Reply and tell me a bit about your setup (how many entities, what's in the mix) — the most tangled structures go first.";
  return `Hi,

Thanks for ${hasAnswers ? "applying for" : "joining"} the Rhodes ${hasAnswers ? "beta" : "waitlist"}.

The first group is small, and I'm starting with the most tangled setups — people juggling many entities and trusts — because that's where the product gets tested hardest. ${placement}

${closing}

Sean
Founder, Rhodes
rhodesoffice.ai`;
}

function waitlistHtml(hasAnswers: boolean): string {
  const placement = hasAnswers
    ? "Based on your answers I've put you on the waitlist rather than in the first wave."
    : "For now I've put you on the waitlist.";
  const closing = hasAnswers
    ? "You'll hear from me as the group expands. If your situation gets more complicated before then (it usually does), reply here and tell me &mdash; that moves you up."
    : "You'll hear from me as the group expands. <strong>Want to move up?</strong> Reply and tell me a bit about your setup (how many entities, what's in the mix) &mdash; the most tangled structures go first.";
  return wrap(`<p>Hi,</p>
    <p>Thanks for ${hasAnswers ? "applying for" : "joining"} the <strong>Rhodes</strong> ${hasAnswers ? "beta" : "waitlist"}.</p>
    <p>The first group is small, and I'm starting with the most tangled setups &mdash; people juggling many entities and trusts &mdash; because that's where the product gets tested hardest. ${placement}</p>
    <p>${closing}</p>`);
}

// ── Founder notification (internal) ──────────────────────────────────
const NOTIFY_TO = "sean@rhodesoffice.ai";

async function notifyFounder(
  resendKey: string,
  record: WaitlistRecord,
  branch: string,
): Promise<void> {
  const email = record.email!.trim().toLowerCase();
  const verdict = branch === "invite" ? "✅ INVITED" : branch === "waitlist" ? "⏳ waitlisted" : "✉️ bare signup";
  const answers = record.entity_count
    ? `${record.entity_count} entities · ${record.asset_mix ?? "?"} · tracks via ${record.tracking_method ?? "?"}`
    : "no application answers (bare email form)";
  // The webhook payload's record carries all row columns:
  const r = record as WaitlistRecord & {
    utm_campaign?: string | null;
    landing_variant?: string | null;
    referrer?: string | null;
  };
  const src = [r.utm_source, r.utm_campaign, r.landing_variant ? `hero:${r.landing_variant}` : null]
    .filter(Boolean).join(" / ") || (r.referrer ? `referral: ${r.referrer}` : "direct/unknown");

  const subject = `Waitlist: ${email} — ${verdict}`;
  const text = `${email}\n${verdict}\n${answers}\nSource: ${src}`;

  // Email (uses the already-configured Resend key)
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Rhodes Signups <sean@notify.rhodesoffice.ai>",
        to: [NOTIFY_TO],
        subject,
        text,
      }),
    });
  } catch (e) {
    console.error("founder email notify failed", e); // never block the applicant flow
  }

  // Slack (optional): create an Incoming Webhook in Slack, then
  //   supabase secrets set SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…
  // No secret set = silently skipped.
  const slack = Deno.env.get("SLACK_WEBHOOK_URL");
  if (slack) {
    try {
      await fetch(slack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${verdict}* — ${email}\n${answers}\nSource: ${src}` }),
      });
    } catch (e) {
      console.error("slack notify failed", e);
    }
  }
}

// ── Handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WAITLIST_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: { type?: string; record?: WaitlistRecord };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (payload.type !== "INSERT" || !payload.record?.email) {
    return new Response("ignored", { status: 200 });
  }
  if (payload.record.utm_source === "test") {
    return new Response("skipped test signup", { status: 200 });
  }

  const record = payload.record;
  const email = record.email!.trim().toLowerCase();
  const resendKey = Deno.env.get("RESEND_MARKETING_API_KEY");
  if (!resendKey) {
    console.error("RESEND_MARKETING_API_KEY not set");
    return new Response("misconfigured", { status: 500 });
  }

  // Bare signups (no apply-form fields) fall through to the waitlist note —
  // the apply form replaced the old Google-form survey email entirely.
  const hasAnswers = Boolean(record.entity_count);
  let subject: string, html: string, text: string, branch: string;
  if (hasAnswers && isQualified(record)) {
    subject = INVITE_SUBJECT; html = inviteHtml(); text = inviteText(); branch = "invite";
  } else {
    subject = WAITLIST_SUBJECT; html = waitlistHtml(hasAnswers); text = waitlistText(hasAnswers); branch = hasAnswers ? "waitlist" : "waitlist-bare";
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      reply_to: REPLY_TO,
      subject,
      html,
      text,
    }),
  });

  // Notify regardless of whether the applicant email succeeded — a signup
  // whose welcome email failed is the one that needs manual follow-up.
  await notifyFounder(resendKey, record, branch);

  if (!resp.ok) {
    console.error(`Resend send failed for ${email} (${branch}): ${resp.status} ${await resp.text()}`);
    return new Response("send failed (logged)", { status: 200 });
  }

  console.log(`${branch} email sent to ${email}`);
  return new Response("sent", { status: 200 });
});
