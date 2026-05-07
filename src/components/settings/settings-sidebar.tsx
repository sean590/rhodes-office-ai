"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  UserIcon,
  ShieldIcon,
  GearIcon,
  DocIcon,
  PeopleIcon,
  ClockIcon,
} from "@/components/ui/icons";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  adminOnly?: boolean;
}

const SETTINGS_NAV: NavItem[] = [
  { href: "/settings/profile", label: "Profile", Icon: UserIcon },
  { href: "/settings/security", label: "Security", Icon: ShieldIcon },
  { href: "/settings/compliance", label: "Compliance", Icon: GearIcon },
  { href: "/settings/documents", label: "Documents", Icon: DocIcon },
  { href: "/settings/team", label: "Team", Icon: PeopleIcon, adminOnly: true },
  { href: "/settings/activity", label: "Activity", Icon: ClockIcon, adminOnly: true },
];

export function SettingsSidebar() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setIsAdmin(
          data.role === "admin" ||
            data.orgRole === "owner" ||
            data.orgRole === "admin"
        );
      })
      .catch(() => {});
  }, []);

  const visibleItems = SETTINGS_NAV.filter((item) => !item.adminOnly || isAdmin);

  if (isMobile) {
    return (
      <nav
        style={{
          display: "flex",
          gap: 4,
          overflowX: "auto",
          padding: "0 0 8px 0",
          marginBottom: 12,
          borderBottom: "1px solid #e8e6df",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {visibleItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 7,
                background: isActive ? "#e8e6df" : "transparent",
                color: isActive ? "#2d5a3d" : "#6b6b76",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <item.Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {visibleItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 7,
              background: isActive ? "#e8e6df" : "transparent",
              color: isActive ? "#2d5a3d" : "#6b6b76",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              transition: "background 0.15s",
            }}
          >
            <item.Icon size={16} color={isActive ? "#2d5a3d" : "#6b6b76"} />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
