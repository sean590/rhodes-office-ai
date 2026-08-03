/**
 * AWS SES inbound webhook (SNS delivery).
 *
 * SES → S3 → SNS → here. We verify the SNS signature (a public endpoint must
 * not trust its body), auto-confirm the subscription handshake, and defer the
 * heavy work (S3 fetch + MIME parse + pipeline ingest) to after() so the
 * request returns fast — SNS retries on non-2xx, so slow inline work would
 * cause duplicate deliveries.
 */
import { NextResponse, after } from "next/server";
// System webhook: SNS delivery is unauthenticated and has no user/org context
// (the org is resolved from the recipient address inside handleSesNotification).
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifySnsSignature,
  confirmSnsSubscription,
  handleSesNotification,
  type SnsEnvelope,
} from "@/lib/inbound/ses";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let msg: SnsEnvelope;
  try {
    msg = (await request.json()) as SnsEnvelope;
  } catch {
    // SNS sometimes sends text/plain; fall back to raw text.
    try {
      msg = JSON.parse(await request.text()) as SnsEnvelope;
    } catch {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }
  }

  // Optional defense-in-depth: only accept our own topic when configured.
  const expectedTopic = process.env.INBOUND_SES_TOPIC_ARN;
  if (expectedTopic && msg.TopicArn !== expectedTopic) {
    return NextResponse.json({ error: "unexpected topic" }, { status: 403 });
  }

  const valid = await verifySnsSignature(msg);
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  if (msg.Type === "SubscriptionConfirmation") {
    const ok = await confirmSnsSubscription(msg);
    return NextResponse.json({ confirmed: ok }, { status: ok ? 200 : 502 });
  }

  if (msg.Type === "Notification") {
    // Fast ack; process out-of-band so SNS doesn't retry on a slow request.
    const message = msg.Message;
    after(async () => {
      try {
        const admin = createAdminClient();
        const res = await handleSesNotification(admin, message);
        console.log(`[inbound/ses] ${res.status}`);
      } catch (err) {
        console.error("[inbound/ses] processing failed:", err);
      }
    });
    return NextResponse.json({ ok: true });
  }

  // UnsubscribeConfirmation or anything else — acknowledge.
  return NextResponse.json({ ok: true });
}
