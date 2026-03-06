"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface InviteInfo {
  id: string;
  email: string;
  role: string;
  orgName: string;
  inviterName: string;
  expiresAt: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // Check if logged in (manual redirect to prevent following proxy redirect to /login)
        const meRes = await fetch("/api/auth/me", { redirect: "manual" });
        setIsLoggedIn(meRes.ok);

        // Fetch invite details
        const res = await fetch(`/api/invites/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Invite not found");
          return;
        }
        setInvite(await res.json());
      } catch {
        setError("Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const res = await fetch(`/api/invites/${token}`, { method: "POST" });
      if (res.ok) {
        router.push("/entities");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to accept invite");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setAccepting(false);
    }
  };

  const handleSignIn = () => {
    // Redirect to login with next param to come back here
    router.push(`/login?next=/invite/${token}`);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f5f4f0" }}>
        <div style={{ color: "#6b6b76", fontSize: 15 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f5f4f0", padding: 20 }}>
      <div style={{
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #ddd9d0",
        padding: "40px 32px",
        maxWidth: 440,
        width: "100%",
        textAlign: "center",
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 32 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "linear-gradient(135deg, #2d5a3d, #1a3d2a)",
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 12,
          }}>
            R
          </span>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1f" }}>Rhodes</div>
        </div>

        {error ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1f", marginBottom: 8 }}>
              Invite Unavailable
            </div>
            <p style={{ color: "#6b6b76", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              {error}
            </p>
            <Button onClick={() => router.push("/login")}>
              Go to Login
            </Button>
          </div>
        ) : invite ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1f", marginBottom: 8 }}>
              You&#39;ve been invited to join
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#2d5a3d", marginBottom: 8 }}>
              {invite.orgName}
            </div>
            <p style={{ color: "#6b6b76", fontSize: 14, lineHeight: 1.6, marginBottom: 4 }}>
              {invite.inviterName} invited you as a <strong>{invite.role}</strong>
            </p>
            <p style={{ color: "#9b9ba5", fontSize: 12, marginBottom: 24 }}>
              Invite for {invite.email}
            </p>

            {isLoggedIn ? (
              <Button
                variant="primary"
                onClick={handleAccept}
                disabled={accepting}
                style={{ padding: "12px 32px", fontSize: 14 }}
              >
                {accepting ? "Joining..." : "Accept Invite"}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleSignIn}
                style={{ padding: "12px 32px", fontSize: 14 }}
              >
                Sign in to Accept
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
