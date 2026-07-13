"use client";

/**
 * Tabs — responsive priority + overflow tab bar (UX refresh §3.12 / Phase 4).
 *
 * Replaces the side-scrolling tab strip on detail pages. A ResizeObserver
 * measures the container; the tabs that fit render inline, the rest collapse
 * into a "More ▾" menu. If the active tab would have overflowed, it's pulled
 * into the visible set (swapping out the last fitting tab) so you're never on a
 * tab you can't see. Underline style, on tokens. Reused by entity + investment
 * detail.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

export interface TabItem {
  id: string;
  label: string;
}

const GAP = 2;
const MORE_W = 76; // reserved width for the "More ▾" button when overflowing

export function Tabs({
  tabs, active, onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [containerW, setContainerW] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const labelKey = tabs.map((t) => `${t.id}:${t.label}`).join("|");

  // Measure each tab's natural width from a hidden mirror row.
  useLayoutEffect(() => {
    if (!measureRef.current) return;
    setWidths(Array.from(measureRef.current.children).map((c) => (c as HTMLElement).offsetWidth));
  }, [labelKey]);

  // Track available width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close the More menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const { visible, overflow } = useMemo(() => {
    if (!widths.length || !containerW || widths.length !== tabs.length) {
      return { visible: tabs, overflow: [] as TabItem[] };
    }
    const total = widths.reduce((s, w) => s + w + GAP, 0);
    if (total <= containerW) return { visible: tabs, overflow: [] as TabItem[] };

    // How many fit alongside the More button.
    let used = MORE_W;
    let fit = 0;
    for (let i = 0; i < tabs.length; i++) {
      used += widths[i] + GAP;
      if (used <= containerW) fit++;
      else break;
    }
    fit = Math.max(1, fit);

    const chosen = new Set<number>();
    for (let i = 0; i < fit; i++) chosen.add(i);
    const activeIdx = tabs.findIndex((t) => t.id === active);
    if (activeIdx >= 0 && !chosen.has(activeIdx)) {
      chosen.delete(fit - 1); // drop the last fitting tab to make room
      chosen.add(activeIdx);
    }
    return {
      visible: tabs.filter((_, i) => chosen.has(i)),
      overflow: tabs.filter((_, i) => !chosen.has(i)),
    };
  }, [widths, containerW, tabs, active]);

  const tabBtn = (tab: TabItem, isActive: boolean): React.CSSProperties => ({
    padding: "10px 16px",
    fontSize: 13.5,
    fontWeight: isActive ? 600 : 500,
    cursor: "pointer",
    border: "none",
    borderBottom: `2px solid ${isActive ? "var(--green)" : "transparent"}`,
    background: "transparent",
    color: isActive ? "var(--ink)" : "var(--muted)",
    marginBottom: -1,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    flexShrink: 0,
  });

  const overflowActive = overflow.some((t) => t.id === active);

  return (
    <div ref={containerRef} style={{ position: "relative", borderBottom: "1px solid var(--line)", marginBottom: 24, display: "flex", alignItems: "stretch" }}>
      {/* Hidden mirror row for width measurement. */}
      <div ref={measureRef} aria-hidden style={{ position: "absolute", visibility: "hidden", height: 0, overflow: "hidden", display: "flex", whiteSpace: "nowrap" }}>
        {tabs.map((t) => <span key={t.id} style={tabBtn(t, false)}>{t.label}</span>)}
      </div>

      {visible.map((tab) => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={tabBtn(tab, tab.id === active)}>
          {tab.label}
        </button>
      ))}

      {overflow.length > 0 && (
        <div style={{ position: "relative", display: "flex" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{ ...tabBtn({ id: "__more", label: "More" }, overflowActive), display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            More <Icon name="chevron-down" size={14} />
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 30, minWidth: 180, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 10px 30px rgba(20,24,20,0.12)", padding: 6, marginTop: 2 }}>
              {overflow.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { onChange(tab.id); setMenuOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7,
                    border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5,
                    fontWeight: tab.id === active ? 600 : 500,
                    color: tab.id === active ? "var(--green)" : "var(--ink)",
                    background: tab.id === active ? "var(--green-50)" : "transparent",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
