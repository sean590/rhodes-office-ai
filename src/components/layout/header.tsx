"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BuildingIcon, PeopleIcon, ChartIcon, LinkIcon, DocIcon, ChatIcon, GearIcon } from "../ui/icons";
import { UserMenu } from "./user-menu";

const NAV_TABS = [
  { href: "/entities", label: "Entities", Icon: BuildingIcon },
  { href: "/directory", label: "Directory", Icon: PeopleIcon },
  { href: "/relationships", label: "Relationships", Icon: LinkIcon },
  { href: "/documents", label: "Documents", Icon: DocIcon },
  { href: "/chat", label: "AI Chat", Icon: ChatIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px", height: 54, borderBottom: "1px solid #ddd9d0", background: "#ffffff", flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>R</div>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>Rhodes</span>
        <span style={{
          fontSize: 10, fontWeight: 500, color: "#2d5a3d",
          background: "rgba(45,90,61,0.08)", padding: "2px 8px", borderRadius: 10,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>AI</span>
      </div>

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

      {/* User */}
      <UserMenu />
    </header>
  );
}
