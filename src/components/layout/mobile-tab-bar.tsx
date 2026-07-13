"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "../ui/icon";

// Primary tabs (Chat lives in the drawer FAB, not here). Docs moved into More.
const PRIMARY_TABS: { href: string; label: string; icon: IconName; activeBase: string; aliases?: string[] }[] = [
  { href: "/home", label: "Home", icon: "inbox", activeBase: "/home" },
  { href: "/entities", label: "Entities", icon: "building", activeBase: "/entities" },
  { href: "/investments", label: "Investments", icon: "chart-pie", activeBase: "/investments" },
  { href: "/people", label: "People", icon: "users", activeBase: "/people", aliases: ["/directory", "/service-providers"] },
];

const MORE_TABS: { href: string; label: string; icon: IconName; activeBase: string }[] = [
  { href: "/documents", label: "Docs", icon: "file-text", activeBase: "/documents" },
  { href: "/compliance", label: "Compliance", icon: "checklist", activeBase: "/compliance" },
  { href: "/settings/profile", label: "Settings", icon: "settings", activeBase: "/settings" },
];

const GREEN = "var(--green)";
const FAINT = "var(--faint)";

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const isMoreActive = MORE_TABS.some((t) => pathname.startsWith(t.activeBase));

  return (
    <>
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "var(--card)", borderRadius: "16px 16px 0 0",
              padding: "20px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
              boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--line-2)", margin: "0 auto 16px" }} />
            {MORE_TABS.map((tab) => {
              const active = pathname.startsWith(tab.activeBase);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  onClick={() => setMoreOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 12px", borderRadius: 8,
                    background: active ? "var(--green-50)" : "transparent",
                    color: active ? GREEN : "var(--ink)",
                    fontWeight: active ? 600 : 400, fontSize: 15, textDecoration: "none",
                  }}
                >
                  <Icon name={tab.icon} size={20} color={active ? GREEN : "var(--ink)"} />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <nav style={{
        display: "flex", justifyContent: "space-around", alignItems: "center",
        height: `calc(56px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: "var(--card)", borderTop: "1px solid var(--line)",
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40,
      }}>
        {PRIMARY_TABS.map((tab) => {
          const active = pathname.startsWith(tab.activeBase) || (tab.aliases?.some((a) => pathname.startsWith(a)) ?? false);
          return (
            <Link key={tab.href} href={tab.href} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              padding: "4px 0", minWidth: 56, textDecoration: "none",
            }}>
              <Icon name={tab.icon} size={22} color={active ? GREEN : FAINT} />
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, color: active ? GREEN : FAINT }}>{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "4px 0", minWidth: 56, background: "none", border: "none", cursor: "pointer",
          }}
        >
          <Icon name="dots" size={22} color={isMoreActive ? GREEN : FAINT} />
          <span style={{ fontSize: 10, fontWeight: isMoreActive ? 600 : 400, color: isMoreActive ? GREEN : FAINT }}>More</span>
        </button>
      </nav>
    </>
  );
}
