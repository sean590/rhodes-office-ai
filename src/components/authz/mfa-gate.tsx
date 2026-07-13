"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side MFA gate (UX). On entry to the authenticated app it does three
 * things based on the user's factor + grace state:
 *  1. Enrolled but session still aal1 → send to /auth/mfa to complete the challenge.
 *  2. Not enrolled and PAST the grace deadline → hard-redirect to /settings/security.
 *  3. Not enrolled and still IN grace → show a non-blocking enrollment nag.
 *
 * The security boundary is the server (`requireSensitive` / `requireAal2`); this
 * is UX so users aren't surprised. The exempt pages (/settings/security, /auth/*)
 * are never redirected/nagged so enrollment stays reachable.
 */
export function MfaGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [nagDaysLeft, setNagDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled || !aal) return;

        const onExemptPage =
          !!pathname && (pathname.startsWith("/settings/security") || pathname.startsWith("/auth"));

        // 1. Enrolled but not challenged this session → step up.
        if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
          if (!onExemptPage) {
            const dest = pathname && !pathname.startsWith("/auth") ? pathname : "/home";
            router.replace(`/auth/mfa?next=${encodeURIComponent(dest)}`);
          }
          return;
        }

        const enrolled = aal.currentLevel === "aal2" || aal.nextLevel === "aal2";
        if (enrolled || onExemptPage) return;

        // Not enrolled → grace check.
        const res = await fetch("/api/auth/me");
        if (!res.ok || cancelled) return;
        const me = await res.json();
        const graceUntil = me.mfa_grace_until ? new Date(me.mfa_grace_until).getTime() : null;
        const now = Date.now();

        if (graceUntil && now >= graceUntil) {
          router.replace("/settings/security?reason=mfa_required");
          return;
        }
        if (graceUntil) {
          setNagDaysLeft(Math.max(0, Math.ceil((graceUntil - now) / (24 * 60 * 60 * 1000))));
        }
      } catch {
        /* non-fatal — server still enforces on sensitive actions */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on entering the authenticated app (layout persists across nav).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (nagDaysLeft === null) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9998,
        background: "#1a1a1f",
        color: "#fff",
        borderRadius: 10,
        padding: "12px 18px",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span>
        Set up two-factor authentication to secure your account —{" "}
        <strong>{nagDaysLeft} day{nagDaysLeft === 1 ? "" : "s"} left</strong>.
      </span>
      <a
        href="/settings/security"
        style={{ color: "#8fd0a6", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
      >
        Enroll now →
      </a>
      <button
        onClick={() => setNagDaysLeft(null)}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "#9494a0", cursor: "pointer", fontSize: 16, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
}
