"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Inactivity-based session timeout flow.
 *
 * Tracks real user input (mousemove, keydown, scroll, etc.), throttles
 * heartbeats to /api/auth/heartbeat so the server-side activity cookie stays
 * fresh, shows a warning modal 2 minutes before the cutoff, and gracefully
 * signs the user out at the cutoff with a full-screen overlay before
 * redirecting to /login?reason=inactive.
 *
 * Constants must stay in sync with INACTIVITY_TIMEOUT_MS in
 * src/lib/supabase/middleware.ts.
 */

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — must match middleware
const WARNING_BEFORE_MS = 2 * 60 * 1000; // show warning at T-2:00
const HEARTBEAT_THROTTLE_MS = 60 * 1000; // at most one heartbeat per minute
const TICK_MS = 10 * 1000; // poll inactivity every 10s
const ACTIVITY_STORAGE_KEY = "rhodes_last_activity_client";

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
];

export function SessionTimeoutManager() {
  const lastActivityRef = useRef<number>(Date.now());
  const lastHeartbeatRef = useRef<number>(0);
  const [showWarning, setShowWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(WARNING_BEFORE_MS);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);

  const sendHeartbeat = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/heartbeat", { method: "POST" });
      lastHeartbeatRef.current = Date.now();
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const gracefulLogout = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ignore — we're redirecting regardless
    }
    window.location.href = "/login?reason=inactive";
  }, []);

  const recordActivity = useCallback(() => {
    if (signingOutRef.current) return;
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
    } catch {
      // ignore quota / private mode errors
    }
    if (showWarning) setShowWarning(false);
    if (now - lastHeartbeatRef.current >= HEARTBEAT_THROTTLE_MS) {
      void sendHeartbeat();
    }
  }, [showWarning, sendHeartbeat]);

  // Initialize from localStorage so cross-tab activity carries over.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACTIVITY_STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!Number.isNaN(parsed)) {
          lastActivityRef.current = Math.max(lastActivityRef.current, parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Activity listeners.
  useEffect(() => {
    const handler = () => recordActivity();
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, handler, { passive: true });
    }
    window.addEventListener("focus", handler);
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, handler);
      }
      window.removeEventListener("focus", handler);
    };
  }, [recordActivity]);

  // Cross-tab sync via storage events.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVITY_STORAGE_KEY || !e.newValue) return;
      const parsed = parseInt(e.newValue, 10);
      if (Number.isNaN(parsed)) return;
      if (parsed > lastActivityRef.current) {
        lastActivityRef.current = parsed;
        if (showWarning) setShowWarning(false);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [showWarning]);

  // Visibility change — wake-from-sleep / tab refocus.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > INACTIVITY_TIMEOUT_MS) {
        // Already past the deadline — skip the warning, log out immediately.
        void gracefulLogout();
        return;
      }
      // Treat the wake as activity.
      recordActivity();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [gracefulLogout, recordActivity]);

  // Inactivity poll.
  useEffect(() => {
    const interval = setInterval(() => {
      if (signingOutRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        void gracefulLogout();
      } else if (elapsed >= INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS) {
        setShowWarning(true);
        setRemainingMs(INACTIVITY_TIMEOUT_MS - elapsed);
      } else if (showWarning) {
        setShowWarning(false);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [gracefulLogout, showWarning]);

  // Live countdown while warning modal is open.
  useEffect(() => {
    if (!showWarning) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        void gracefulLogout();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showWarning, gracefulLogout]);

  const onStaySignedIn = useCallback(async () => {
    const ok = await sendHeartbeat();
    if (!ok) {
      // Server says we're already gone — log out gracefully.
      void gracefulLogout();
      return;
    }
    lastActivityRef.current = Date.now();
    try {
      localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setShowWarning(false);
  }, [sendHeartbeat, gracefulLogout]);

  return (
    <>
      {showWarning && !signingOut && (
        <WarningModal remainingMs={remainingMs} onStay={onStaySignedIn} />
      )}
      {signingOut && <SigningOutOverlay />}
    </>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function WarningModal({
  remainingMs,
  onStay,
}: {
  remainingMs: number;
  onStay: () => void;
}) {
  // Trap focus on the Stay button.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 20, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 420,
          width: "calc(100% - 40px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          border: "1px solid #e8e6df",
        }}
      >
        <h2
          id="session-timeout-title"
          style={{
            margin: "0 0 12px",
            fontSize: 20,
            fontWeight: 600,
            color: "#1a1a1a",
          }}
        >
          Still there?
        </h2>
        <p style={{ margin: "0 0 20px", color: "#4a4a52", lineHeight: 1.5 }}>
          You&apos;ll be signed out in{" "}
          <strong style={{ color: "#1a1a1a" }}>
            {formatCountdown(remainingMs)}
          </strong>{" "}
          due to inactivity.
        </p>
        <button
          ref={buttonRef}
          onClick={onStay}
          style={{
            background: "#2d5a3d",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            width: "100%",
          }}
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}

function SigningOutOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(255, 255, 255, 0.95)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10001,
        color: "#4a4a52",
        fontSize: 16,
      }}
    >
      Signing you out…
    </div>
  );
}
