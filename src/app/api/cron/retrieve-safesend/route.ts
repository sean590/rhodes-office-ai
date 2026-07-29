import { NextResponse } from "next/server";
import { processPendingSafesend } from "@/lib/inbound/worker";

// SafeSend auto-retrieval sweep: one delivery per tick (sandbox boot +
// wizard + up-to-3.5-min access-code wait). Fresh deliveries only; relay
// resumes run inline in inbound-poll with the seeded code.
export const maxDuration = 600;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await processPendingSafesend());
  } catch (err) {
    console.error("cron/retrieve-safesend error:", err);
    return NextResponse.json({ error: "Retrieval sweep failed" }, { status: 500 });
  }
}
