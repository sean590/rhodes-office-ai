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
  BuildingIcon,
} from "@/components/ui/icons";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// UX refresh Phase 7: grouped into Account / Organization / Automation.
// Renames: Compliance → "Compliance rules", Documents → "Document requirements",
// Team → "Team & access". Org name moved to Organization → General. The org-wide
// Activity log moved out of Settings to Home → Done.
const SETTINGS_GROUPS: NavGroup[] = [
  {
    title: "Account",
    items: [
      { href: "/settings/profile", label: "Profile", Icon: UserIcon },
      { href: "/settings/security", label: "Security", Icon: ShieldIcon },
    ],
  },
  {
    title: "Organization",
    items: [
      { href: "/settings/general", label: "General", Icon: BuildingIcon },
      { href: "/settings/team", label: "Team & access", Icon: PeopleIcon, adminOnly: true },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/settings/compliance", label: "Compliance rules", Icon: GearIcon },
      { href: "/settings/documents", label: "Document requirements", Icon: DocIcon },
    ],
  },
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

  const visibleGroups = SETTINGS_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => !item.adminOnly || isAdmin) }))
    .filter((g) => g.items.length > 0);

  if (isMobile) {
    // Mobile: a single horizontal scroll of all items (group titles omitted to
    // keep the strip compact).
    const allItems = visibleGroups.flatMap((g) => g.items);
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
        {allItems.map((item) => {
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
        gap: 18,
      }}
    >
      {visibleGroups.map((group) => (
        <div key={group.title} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#9494a0",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "0 12px 4px",
            }}
          >
            {group.title}
          </div>
          {group.items.map((item) => {
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
        </div>
      ))}
    </aside>
  );
}
