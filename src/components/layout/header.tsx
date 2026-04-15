"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { BuildingIcon, ChartIcon, PeopleIcon, LinkIcon, DocIcon, ChatIcon, GearIcon } from "../ui/icons";
import { UserMenu } from "./user-menu";

const NAV_TABS = [
  { href: "/entities", label: "My Entities", Icon: BuildingIcon },
  { href: "/investments", label: "Investments", Icon: ChartIcon },
  { href: "/directory", label: "Directory", Icon: PeopleIcon },
  { href: "/documents", label: "Documents", Icon: DocIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function Header() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.orgName) setOrgName(data.orgName); })
      .catch(() => {});
  }, []);

  if (isMobile) {
    return (
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", height: 48,
        borderBottom: "1px solid #ddd9d0", background: "#ffffff", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 5,
            background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff",
          }}>R</div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Rhodes
          </span>
        </div>
        <UserMenu compact />
      </header>
    );
  }

  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px", height: 54, borderBottom: "1px solid #ddd9d0", background: "#ffffff", flexShrink: 0,
    }}>
      {/* Logo */}
      <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>R</div>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "#1a1a1f" }}>Rhodes</span>
        <span style={{
          fontSize: 10, fontWeight: 500, color: "#2d5a3d",
          background: "rgba(45,90,61,0.08)", padding: "2px 8px", borderRadius: 10,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>AI</span>
        {orgName && (
          <>
            <span style={{ color: "#ddd9d0", fontSize: 14, fontWeight: 300 }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#6b6b76" }}>{orgName}</span>
          </>
        )}
      </Link>

      {/* Nav */}
      <nav style={{ display: "flex", gap: 1 }}>
        {NAV_TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                borderRadius: 7, border: "none", cursor: "pointer",
                background: isActive ? "#e8e6df" : "transparent",
                color: isActive ? "#2d5a3d" : "#6b6b76",
                fontSize: 13, fontWeight: 500, textDecoration: "none",
                transition: "all 0.15s",
              }}
            >
              <tab.Icon size={18} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Search / Command Palette trigger */}
      <button
        onClick={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 12px", borderRadius: 7,
          border: "1px solid #ddd9d0", background: "#f5f4f0",
          cursor: "pointer", color: "#9494a0", fontSize: 13,
          transition: "all 0.15s",
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Search</span>
        <kbd style={{ fontSize: 10, color: "#b0b0b8", background: "#e8e6df", padding: "1px 4px", borderRadius: 3, fontFamily: "monospace" }}>⌘K</kbd>
      </button>

      {/* User */}
      <UserMenu />
    </header>
  );
}
