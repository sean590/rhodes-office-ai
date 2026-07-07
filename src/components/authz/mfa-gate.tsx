"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side MFA challenge gate (UX). On entry to the authenticated app, if the
 * user has a verified factor but their session is still aal1 (hasn't completed
 * the challenge this session), send them to /auth/mfa to step up.
 *
 * Non-blocking for users WITHOUT a factor (nextLevel !== "aal2" → no redirect) —
 * enrollment enforcement is separate (Increment 3, chunk 2). The security
 * boundary for sensitive actions is the server `requireAal2` guard, not this.
 */
export function MfaGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        // Enrolled but not yet challenged this session → complete the challenge.
        if (data?.currentLevel === "aal1" && data?.nextLevel === "aal2") {
          const dest = pathname && !pathname.startsWith("/auth") ? pathname : "/home";
          router.replace(`/auth/mfa?next=${encodeURIComponent(dest)}`);
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

  return null;
}
