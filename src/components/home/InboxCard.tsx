"use client";

/**
 * InboxCard — the shared Action-Inbox primitive (the spec's "ApprovalCard").
 * One card for staged chat actions, review items, and filings: icon + title +
 * channel chip + meta, an optional warning band, and inline actions. Reused on
 * Home (and later in chat / entity pages).
 */

import React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export type Channel = "chat" | "email" | "compliance" | "upload" | "portal";

const CHANNEL: Record<Channel, { label: string; color: string; bg: string }> = {
  chat: { label: "from chat", color: "var(--green)", bg: "var(--green-50)" },
  email: { label: "from email", color: "var(--blue)", bg: "var(--blue-50)" },
  compliance: { label: "compliance", color: "var(--amber)", bg: "var(--amber-50)" },
  upload: { label: "from upload", color: "var(--muted)", bg: "var(--page)" },
  portal: { label: "from portal", color: "var(--purple)", bg: "var(--purple-50)" },
};

export interface InboxAction {
  label: string;
  variant?: "primary" | "secondary";
  onClick?: () => void;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
}

export function InboxCard({
  icon, iconColor, title, channel, meta, subtitle, badge, warning, actions,
}: {
  icon: IconName;
  iconColor: string;
  title: string;
  channel?: Channel;
  meta?: string;
  subtitle?: React.ReactNode;
  badge?: { text: string; color: string };
  warning?: string;
  actions: InboxAction[];
}) {
  const ch = channel ? CHANNEL[channel] : null;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
        <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--page)", color: iconColor }}>
          <Icon name={icon} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {ch && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 5, color: ch.color, background: ch.bg }}>{ch.label}</span>
            )}
            {(meta || subtitle) && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{subtitle ?? meta}</span>}
          </div>
        </div>
        {badge && (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: badge.color }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: badge.color }} />
            {badge.text}
          </span>
        )}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {actions.map((a, i) =>
            a.href ? (
              <Link key={i} href={a.href} style={{ textDecoration: "none" }}>
                <Button variant={a.variant ?? "secondary"}>{a.label}</Button>
              </Link>
            ) : (
              <Button key={i} variant={a.variant ?? "secondary"} onClick={a.onClick} disabled={a.disabled || a.busy}>
                {a.busy ? "…" : a.label}
              </Button>
            ),
          )}
        </div>
      </div>
      {warning && (
        <div style={{ padding: "8px 16px", background: "var(--amber-50)", borderTop: "1px solid var(--line)", color: "var(--amber)", fontSize: 12.5 }}>
          {warning}
        </div>
      )}
    </div>
  );
}

export function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 10px" }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--faint)" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: "var(--line)", color: "var(--muted)" }}>{count}</span>
    </div>
  );
}
