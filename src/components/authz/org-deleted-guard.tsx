"use client";

/**
 * Offboarding lockout UI. When the active org is soft-deleted (30-day grace),
 * requireOrg 403s every data route — so instead of letting the app render into
 * a wall of errors, this full-screen guard takes over:
 *   - Owner  → recovery screen (self-serve Recover within the grace).
 *   - Member → a scheduled-for-deletion notice (contact the owner).
 * Mirrors the other layout guards (MfaGate/StepUpGuard): fetch once, render null
 * when there's nothing to block.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface DeletedState {
  scheduledFor: string | null;
  isOwner: boolean;
  orgId: string;
  orgName: string;
}

export function OrgDeletedGuard() {
  const router = useRouter();
  const [state, setState] = useState<DeletedState | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (cancelled || !me?.orgDeleted) return;
        setState({
          scheduledFor: me.deletionScheduledFor ?? null,
          isOwner: me.orgRole === "owner",
          orgId: me.orgId,
          orgName: me.orgName || "this organization",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;

  const when = state.scheduledFor
    ? new Date(state.scheduledFor).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  const handleRecover = async () => {
    setRecovering(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${state.orgId}/recover`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't recover the account.");
      }
      window.location.href = "/home"; // full reload → clears the lockout state
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't recover the account.");
      setRecovering(false);
    }
  };

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#faf9f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#fff",
          border: "1px solid #e8e6df",
          borderRadius: 14,
          padding: 32,
          boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            fontWeight: 600,
            color: "#c47520",
            background: "#fbf3e8",
            borderRadius: 999,
            padding: "3px 10px",
            marginBottom: 16,
          }}
        >
          Scheduled for deletion
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1f", margin: "0 0 10px 0", letterSpacing: "-0.02em" }}>
          {state.isOwner ? "This account is scheduled for deletion" : `${state.orgName} is scheduled for deletion`}
        </h1>
        <p style={{ fontSize: 14, color: "#6b6b76", lineHeight: 1.6, margin: "0 0 20px 0" }}>
          {when ? (
            <>
              On <strong style={{ color: "#1a1a1f" }}>{when}</strong>, {state.orgName} and all of its data will be
              permanently deleted.{" "}
            </>
          ) : (
            <>{state.orgName} and all of its data are scheduled to be permanently deleted. </>
          )}
          {state.isOwner
            ? "Everything is preserved until then — recover the account now to restore full access."
            : "Everything is preserved until then. Your account owner can recover it before that date — reach out to them if this is unexpected."}
        </p>

        {error && (
          <div style={{ fontSize: 13, color: "#c73e3e", marginBottom: 14 }}>{error}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {state.isOwner && (
            <button
              onClick={handleRecover}
              disabled={recovering}
              style={{
                background: recovering ? "#e8e6df" : "#2d5a3d",
                color: recovering ? "#9494a0" : "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                cursor: recovering ? "default" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {recovering ? "Recovering…" : "Recover account"}
            </button>
          )}
          <button
            onClick={handleSignOut}
            style={{
              background: "none",
              border: "none",
              color: "#6b6b76",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "10px 4px",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
