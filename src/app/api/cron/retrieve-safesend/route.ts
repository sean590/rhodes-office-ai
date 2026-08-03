import { NextResponse } from "next/server";
import { processPendingSafesend } from "@/lib/inbound/worker";

// SafeSend auto-retrieval sweep. Each claimed delivery boots a sandbox, clicks
// Verify, and holds the verified session open for up to a 10-min window while
// the access code is forwarded in (Gmail inline OR the transport-agnostic DB
// relay). 800s = Vercel Pro's max function duration, covering boot (~40s) +
// verify (~30s) + the 10-min window + download (~60s) with headroom.
export const maxDuration = 800;

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
