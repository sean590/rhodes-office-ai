"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { OrgRole } from "@/lib/types/enums";
import { can as canPolicy, type Capability } from "@/lib/authz/policy";

/**
 * Client-side role context for UI gating. Fetches the caller's org role once
 * (from /api/auth/me) and exposes `useCan(capability)` so components can hide
 * controls the user's role can't use.
 *
 * IMPORTANT: this is UX only. The server (route guards + MCP) is the security
 * boundary and enforces the SAME matrix from `@/lib/authz/policy`. Hiding a
 * button never replaces the server check.
 */
const RoleContext = createContext<OrgRole | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<OrgRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.orgRole) setRole(data.orgRole as OrgRole);
      })
      .catch(() => {
        /* non-fatal — useCan stays false; server still enforces */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** The current user's org role, or null while loading / unknown. */
export function useOrgRole(): OrgRole | null {
  return useContext(RoleContext);
}

/**
 * True if the current user's role holds `cap`. Returns FALSE while the role is
 * still loading — for destructive controls it's better to briefly hide then
 * reveal than to flash a button the user can't use.
 */
export function useCan(cap: Capability): boolean {
  const role = useContext(RoleContext);
  return role ? canPolicy(role, cap) : false;
}
