"use client";

import { useEffect, useRef } from "react";

/**
 * Intercepts fetch() to /api/* and reacts to the MFA 403 codes from
 * `requireSensitive`/`requireAal2`:
 *  - `step_up_required`      → the user is enrolled but hasn't completed a
 *                              challenge this session → send to /auth/mfa.
 *  - `mfa_enrollment_required` → the user has no factor → send to enroll.
 * Plain RBAC 403s (`code: "forbidden"`) pass through untouched.
 *
 * Mirrors SessionGuard's fetch-patch. The response is still returned to the
 * caller; we just navigate on top of it.
 */
export function StepUpGuard() {
  const patched = useRef(false);

  useEffect(() => {
    if (patched.current) return;
    patched.current = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      const url =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof Request
          ? args[0].url
          : args[0] instanceof URL
          ? args[0].href
          : "";

      if (response.status === 403 && url.includes("/api/")) {
        try {
          const body = await response.clone().json();
          const code = body?.code;
          if (code === "step_up_required") {
            const next = encodeURIComponent(window.location.pathname || "/home");
            window.location.href = `/auth/mfa?next=${next}`;
          } else if (code === "mfa_enrollment_required") {
            window.location.href = "/settings/security?reason=mfa_required";
          }
        } catch {
          /* non-JSON / no code (e.g. plain RBAC forbidden) — pass through */
        }
      }

      return response;
    };
  }, []);

  return null;
}
