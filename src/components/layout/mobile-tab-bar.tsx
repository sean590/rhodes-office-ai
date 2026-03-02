"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BuildingIcon, DocIcon, PeopleIcon, ChatIcon,
  LinkIcon, GearIcon, EllipsisIcon,
} from "../ui/icons";

const PRIMARY_TABS = [
  { href: "/entities", label: "Entities", Icon: BuildingIcon },
  { href: "/documents", label: "Docs", Icon: DocIcon },
  { href: "/directory", label: "Directory", Icon: PeopleIcon },
  { href: "/chat", label: "Chat", Icon: ChatIcon },
];

const MORE_TABS = [
  { href: "/relationships", label: "Relationships", Icon: LinkIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const isMoreActive = MORE_TABS.some((t) => pathname.startsWith(t.href));

  return (
    <>
      {/* More tray backdrop + sheet */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.3)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "#ffffff",
              borderRadius: "16px 16px 0 0",
              padding: "20px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
              boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
            }}
          >
            {/* Drag indicator */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: "#ddd9d0", margin: "0 auto 16px",
            }} />
            {MORE_TABS.map((tab) => {
              const active = pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  onClick={() => setMoreOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 12px", borderRadius: 8,
                    background: active ? "rgba(45,90,61,0.08)" : "transparent",
                    color: active ? "#2d5a3d" : "#1a1a1f",
                    fontWeight: active ? 600 : 400,
                    fontSize: 15, textDecoration: "none",
                  }}
                >
                  <tab.Icon size={20} color={active ? "#2d5a3d" : "#1a1a1f"} />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav style={{
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        height: 56,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: "#ffffff",
        borderTop: "1px solid #ddd9d0",
        flexShrink: 0,
        position: "sticky",
        bottom: 0,
        zIndex: 40,
      }}>
        {PRIMARY_TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: 2,
              padding: "4px 0", minWidth: 56,
              textDecoration: "none",
            }}>
              <tab.Icon size={22} color={active ? "#2d5a3d" : "#9494a0"} />
              <span style={{
                fontSize: 10, fontWeight: active ? 600 : 400,
                color: active ? "#2d5a3d" : "#9494a0",
              }}>{tab.label}</span>
            </Link>
          );
        })}
        {/* More button */}
        <button
          onClick={() => setMoreOpen(true)}
          style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", gap: 2,
            padding: "4px 0", minWidth: 56,
            background: "none", border: "none", cursor: "pointer",
          }}
        >
          <EllipsisIcon size={22} color={isMoreActive ? "#2d5a3d" : "#9494a0"} />
          <span style={{
            fontSize: 10, fontWeight: isMoreActive ? 600 : 400,
            color: isMoreActive ? "#2d5a3d" : "#9494a0",
          }}>More</span>
        </button>
      </nav>
    </>
  );
}
