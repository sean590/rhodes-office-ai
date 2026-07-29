import { NextResponse } from "next/server";
import { processInboundMail } from "@/lib/inbound/worker";

// Inbound v1 mailbox poll (rhodes-inbound-v1-build-plan.md): triage new mail
// every 5 minutes. Attachments are staged+queued for the process-queue
// sweeper; everything unfetchable becomes a needs_user nudge. Bounded work
// per run (15 messages); no extraction happens inline here.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processInboundMail();
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron/inbound-poll error:", err);
    return NextResponse.json({ error: "Inbound poll failed" }, { status: 500 });
  }
}
