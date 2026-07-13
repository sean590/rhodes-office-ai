import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/utils/rate-limit";
import { lookupValidSend, logSendAccess, resolveSenderLabel, getSendDocuments } from "@/lib/providers/share-link";
import { ShareDownload } from "./ShareDownload";

// Public, unauthenticated share page (providers are not Rhodes users). Lives
// OUTSIDE the (authenticated) group. Validates the token server-side; all
// failures collapse to one generic "no longer available" message.

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f4f0", fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ background: "#2d5a3d", borderRadius: "8px 8px 0 0", padding: "20px 28px" }}>
          <span style={{ color: "#fff", fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px" }}>Rhodes</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #ddd9d0", borderTop: "none", borderRadius: "0 0 8px 8px", padding: 28 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <Shell>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1f", margin: "0 0 8px" }}>This link is no longer available</h1>
      <p style={{ fontSize: 14, color: "#6b6b76", lineHeight: 1.6, margin: 0 }}>
        The secure link you followed has expired, been revoked, or is invalid. Please ask the sender to share it again.
      </p>
    </Shell>
  );
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  const allowed = await rateLimit("share-view:" + ip, 60, 60_000);
  const send = allowed ? await lookupValidSend(admin, token) : null;
  if (!send) return <Unavailable />;

  // The bundle's documents + a friendly sender label.
  const [documents, senderName] = await Promise.all([
    getSendDocuments(admin, send),
    resolveSenderLabel(admin, send.sent_by, send.organization_id),
  ]);

  await logSendAccess(admin, send, "viewed", { ip, userAgent: h.get("user-agent") });

  return (
    <Shell>
      <ShareDownload
        token={token}
        documents={documents.map((d) => ({ id: d.id, name: d.name }))}
        senderName={senderName}
      />
    </Shell>
  );
}
