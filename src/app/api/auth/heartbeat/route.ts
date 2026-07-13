import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lightweight heartbeat endpoint used by SessionTimeoutManager to keep the
 * server-side `rhodes_last_activity` cookie fresh during long stretches of
 * client-only activity (mouse moves, keypresses, scrolling).
 *
 * The middleware on this request already wrote a fresh activity cookie because
 * the request hit middleware. The route handler just exists so the client has
 * something to call.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
