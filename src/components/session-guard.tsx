"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Intercepts all fetch() calls to /api/* routes. If a 401 is returned
 * (session expired), shows a brief "Signing you out…" overlay and redirects
 * to /login?reason=inactive instead of letting the UI silently fail.
 *
 * Skips the /api/auth/heartbeat endpoint — its 401s are SessionTimeoutManager's
 * own signal to trigger the full graceful logout flow, and we don't want the
 * two paths to race.
 */
export function SessionGuard() {
  const patched = useRef(false);
  const [signingOut, setSigningOut] = useState(false);

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

      if (
        response.status === 401 &&
        url.includes("/api/") &&
        !url.includes("/api/auth/heartbeat") &&
        window.location.pathname !== "/login"
      ) {
        setSigningOut(true);
        setTimeout(() => {
          window.location.href = "/login?reason=inactive";
        }, 300);
      }

      return response;
    };
  }, []);

  if (!signingOut) return null;

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
