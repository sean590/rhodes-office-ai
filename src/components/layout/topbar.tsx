"use client";

/**
 * Topbar — slim top bar for the UX refresh. Left: nav toggle (collapse rail on
 * desktop / open drawer on mobile) + logo + org. Right: notifications + account.
 * The page nav now lives in the Sidebar.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./NotificationBell";

export function Topbar({
  isMobile,
  onToggleNav,
}: {
  isMobile: boolean;
  onToggleNav: () => void;
}) {
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.orgName) setOrgName(data.orgName); })
      .catch(() => {});
  }, []);

  return (
    <header
      style={{
        height: "var(--topbar-h)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: isMobile ? "0 12px" : "0 16px",
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      <button
        onClick={onToggleNav}
        aria-label="Toggle navigation"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: 8, border: "none",
          background: "transparent", cursor: "pointer", color: "var(--muted)", flexShrink: 0,
        }}
      >
        <Icon name={isMobile ? "menu-2" : "layout-sidebar"} size={19} />
      </button>

      <Link href="/home" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
        <div
          style={{
            width: 22, height: 22, borderRadius: 6, background: "var(--green)",
            display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, color: "#fff",
          }}
        >
          R
        </div>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)" }}>Rhodes</span>
        {orgName && !isMobile && (
          <>
            <span style={{ color: "var(--line-2)", fontSize: 14 }}>/</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{orgName}</span>
          </>
        )}
      </Link>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <NotificationBell />
        <UserMenu compact={isMobile} />
      </div>
    </header>
  );
}
