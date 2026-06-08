"use client";

/**
 * Sidebar — the canonical left nav for the UX refresh. Three responsive tiers:
 *   • > 1024px  — expanded (208px) with labels; user can collapse to a rail
 *   • ≤ 1024px  — icon rail (60px)
 *   • ≤ 768px   — off-canvas drawer (mobile), toggled from the Topbar hamburger
 * Active state lights up on path prefix; Home + People absorb their old routes.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Extra path prefixes that should also mark this item active (route merges). */
  alias?: string[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "inbox", alias: ["/home"] },
  { href: "/entities", label: "Entities", icon: "building" },
  { href: "/investments", label: "Investments", icon: "chart-pie" },
  { href: "/documents", label: "Documents", icon: "file-text" },
  { href: "/compliance", label: "Compliance", icon: "checklist" },
  // People = the Directory + Providers merge (full unification lands in Phase 6).
  { href: "/directory", label: "People", icon: "users", alias: ["/service-providers", "/people"] },
];

export function Sidebar({
  collapsed,
  isMobile,
  mobileOpen,
  onNavigate,
}: {
  collapsed: boolean;
  isMobile: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  // On mobile the drawer is always full-width labels; only desktop uses the rail.
  const rail = collapsed && !isMobile;

  const isActive = (item: NavItem) =>
    [item.href, ...(item.alias ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));

  const nav = (
    <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: rail ? "12px 8px" : "12px 10px" }}>
      {NAV.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={rail ? item.label : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: rail ? "center" : "flex-start",
              gap: 11,
              padding: rail ? "10px 0" : "9px 12px",
              borderRadius: 9,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? "var(--green)" : "var(--muted)",
              background: active ? "var(--green-50)" : "transparent",
              whiteSpace: "nowrap",
            }}
          >
            <Icon name={item.icon} size={18} stroke={active ? 2 : 1.7} />
            {!rail && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  if (isMobile) {
    return (
      <>
        {mobileOpen && (
          <div
            onClick={onNavigate}
            style={{ position: "fixed", inset: 0, top: "var(--topbar-h)", background: "rgba(0,0,0,0.3)", zIndex: 54 }}
          />
        )}
        <aside
          style={{
            position: "fixed",
            top: "var(--topbar-h)",
            left: 0,
            bottom: 0,
            width: 224,
            background: "var(--card)",
            borderRight: "1px solid var(--line)",
            transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.22s ease",
            zIndex: 55,
            overflowY: "auto",
          }}
        >
          {nav}
        </aside>
      </>
    );
  }

  // Desktop / tablet — in-flow column.
  return (
    <aside
      style={{
        width: rail ? "var(--sidebar-rail-w)" : "var(--sidebar-w)",
        flexShrink: 0,
        background: "var(--card)",
        borderRight: "1px solid var(--line)",
        overflowY: "auto",
        transition: "width 0.18s ease",
      }}
    >
      {nav}
    </aside>
  );
}
