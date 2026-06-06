import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/utils/rate-limit";
import { lookupValidSend, logSendAccess } from "@/lib/providers/share-link";

// POST /api/share/[token] — public (providers are not Rhodes users). Validates
// the token server-side, logs the download with the claimed email, and returns a
// short-lived (60s) signed URL. The generous expiry lives on the token; the
// signed URL it mints is ephemeral, so a leaked final URL dies in a minute.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const GENERIC = { error: "This link is no longer available." };
  try {
    const { token } = await params;

    const h = await headers();
    const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const userAgent = h.get("user-agent");

    // Cheap brute-force hygiene (token is already infeasible at 32 bytes).
    const allowed = await rateLimit("share:" + ip, 30, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const admin = createAdminClient();
    const send = await lookupValidSend(admin, token);
    if (!send) {
      return NextResponse.json(GENERIC, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const claimedEmail = typeof body.email === "string" ? body.email.trim().slice(0, 320) : null;

    await logSendAccess(admin, send, "downloaded", { claimedEmail, ip, userAgent });

    const { data: doc } = await admin
      .from("documents")
      .select("file_path, name")
      .eq("id", send.document_id)
      .maybeSingle();
    if (!doc) {
      return NextResponse.json(GENERIC, { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 60);
    if (signErr || !signed) {
      return NextResponse.json({ error: "Failed to prepare download." }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl, name: doc.name });
  } catch (err) {
    console.error("POST /api/share/[token] error:", err);
    return NextResponse.json(GENERIC, { status: 404 });
  }
}
