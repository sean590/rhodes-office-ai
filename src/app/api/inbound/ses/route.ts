import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import SnsValidator from "sns-validator";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRawEmail, parseSesEvent, sesThreatFlags } from "@/lib/inbound/ses-inbound";
import { resolveOrgByRecipient } from "@/lib/inbound/channels";
import { ingestInboundMessage } from "@/lib/inbound/worker";

// SES→S3→SNS inbound webhook (Plan A, rhodes-inbound-multitenancy-plan.md §4).
// SNS pushes an `email.received` notification here; we verify its signature,
// fetch the raw MIME from OUR S3 bucket, resolve the org from the recipient's
// hosted address, and file it through the existing worker pipeline.
//
// Node runtime (SNS signature crypto + AWS SDK). maxDuration covers the S3
// fetch + MIME parse + storage upload; extraction still defers to the queue.
export const runtime = "nodejs";
export const maxDuration = 120;

const REGION = process.env.INBOUND_SES_REGION || "us-west-2";
const BUCKET = process.env.INBOUND_SES_BUCKET || "rhodes-inbound-email";
const PREFIX = process.env.INBOUND_SES_PREFIX || "inbound/";
const TOPIC_ARN =
  process.env.INBOUND_SNS_TOPIC_ARN || "arn:aws:sns:us-west-2:925432502482:rhodes-inbound-email";

const validator = new SnsValidator();

function validateSignature(envelope: unknown): Promise<void> {
  return new Promise((resolve, reject) =>
    validator.validate(envelope as never, (err: Error | null) => (err ? reject(err) : resolve())),
  );
}

export async function POST(req: Request) {
  const body = await req.text();
  let envelope: {
    Type?: string;
    TopicArn?: string;
    SubscribeURL?: string;
    Message?: string;
  };
  try {
    envelope = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // 1. Reject forged notifications — verify the SNS signature, then that it's
  //    OUR topic. Without this, anyone could POST fake mail into the pipeline.
  try {
    await validateSignature(envelope);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  if (envelope.TopicArn && envelope.TopicArn !== TOPIC_ARN) {
    return NextResponse.json({ error: "unexpected topic" }, { status: 403 });
  }

  // 2. Subscription handshake: confirm by fetching the one-time SubscribeURL.
  if (envelope.Type === "SubscriptionConfirmation") {
    if (envelope.SubscribeURL) await fetch(envelope.SubscribeURL).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (envelope.Type !== "Notification" || !envelope.Message) {
    return NextResponse.json({ ok: true });
  }

  // 3. Parse the SES event (messageId, recipients, verdicts, S3 key).
  let sesMessage: unknown;
  try {
    sesMessage = JSON.parse(envelope.Message);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const evt = parseSesEvent(sesMessage, PREFIX);
  if (!evt) return NextResponse.json({ ok: true });

  // 4. SES already scanned it — drop virus-flagged mail outright.
  if (sesThreatFlags(evt.receipt).virus) {
    console.warn(`[SES] dropped virus-flagged message ${evt.messageId}`);
    return NextResponse.json({ ok: true });
  }

  // 5. Fetch the raw MIME from our own bucket (custody) and parse once.
  let raw: Buffer;
  try {
    const s3 = new S3Client({ region: REGION });
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: evt.s3Key }));
    raw = Buffer.from(await obj.Body!.transformToByteArray());
  } catch (err) {
    console.error(`[SES] S3 fetch failed for ${evt.s3Key}:`, err);
    // 500 → SNS retries; the object should appear (S3 action runs before SNS).
    return NextResponse.json({ error: "s3 fetch failed" }, { status: 500 });
  }

  // 6. Resolve org(s) by recipient and file. Idempotent per (org, messageId).
  const admin = createAdminClient();
  const msg = await parseRawEmail(raw, evt.messageId, evt.receipt);
  let filed = 0;
  for (const recipient of evt.recipients) {
    const resolved = await resolveOrgByRecipient(admin, recipient);
    if (!resolved) {
      console.warn(`[SES] no active channel for recipient ${recipient} (msg ${evt.messageId})`);
      continue;
    }
    await ingestInboundMessage(admin, resolved.orgId, msg);
    filed += 1;
  }
  return NextResponse.json({ ok: true, filed });
}
