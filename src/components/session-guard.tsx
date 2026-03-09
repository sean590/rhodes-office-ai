"use client";

import { useEffect, useRef } from "react";

/**
 * Intercepts all fetch() calls to /api/* routes. If a 401 is returned
 * (session expired), redirects to /login immediately instead of letting
 * the UI silently fail.
 */
export function SessionGuard() {
  const patched = useRef(false);

  useEffect(() => {
    if (patched.current) return;
    patched.current = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      // Only intercept our own API calls
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";
      if (response.status === 401 && url.startsWith("/api/")) {
        // Avoid redirect loops — only redirect if we're not already on /login
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }

      return response;
    };
  }, []);

  return null;
}
