"use client";

/**
 * InboxCard / GroupCard — the Action-Inbox primitives (the spec's "ApprovalCard").
 *
 * InboxCard: one card for a single staged action, review item, or filing —
 * icon + title + channel chip + meta + inline actions, with an OPTIONAL expand
 * revealed by an explicit **Edit** button (never a bare chevron; Edit means
 * "open the editable detail" and it expands in place — it never navigates and
 * never opens /chat). A title is never truncated without that Edit affordance.
 *
 * GroupCard: an origin-event group ("5 documents you added in chat") rendered as
 * ONE cohesive card — header + flat, hairline-divided child rows (no nested
 * cards), each with Approve + Edit. Edit on a grouped row opens the Review
 * sheet at that item. Two-level nesting cap: header → child rows; deeper is the
 * sheet. A "Show N more" footer routes overflow to the sheet.
 */

import React, { useState } from "react";
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

function ActionButtons({ actions }: { actions: InboxAction[] }) {
  return (
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
  );
}

function DupPill({ label = "duplicate" }: { label?: string }) {
  return (
    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 5, color: "var(--amber)", background: "var(--amber-50)" }}>{label}</span>
  );
}

export function InboxCard({
  icon, iconColor, title, channel, meta, subtitle, badge, warning, dupWarning,
  actions, expandedContent, defaultExpanded,
}: {
  icon: IconName;
  iconColor: string;
  title: string;
  channel?: Channel;
  meta?: string;
  subtitle?: React.ReactNode;
  badge?: { text: string; color: string };
  warning?: string;
  /** Amber "possible duplicate" band (spec §5 conflict/duplicate flagging). */
  dupWarning?: string;
  actions: InboxAction[];
  /** When present, an explicit Edit button reveals this untruncated detail in place. */
  expandedContent?: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultExpanded);
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
          <ActionButtons actions={actions} />
          {expandedContent != null && (
            <Button variant="secondary" onClick={() => setOpen((o) => !o)}>{open ? "Done" : "Edit"}</Button>
          )}
        </div>
      </div>
      {dupWarning && (
        <div style={{ padding: "8px 16px", background: "var(--amber-50)", borderTop: "1px solid var(--line)", color: "var(--amber)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="alert-triangle" size={14} /> {dupWarning}
        </div>
      )}
      {warning && (
        <div style={{ padding: "8px 16px", background: "var(--amber-50)", borderTop: "1px solid var(--line)", color: "var(--amber)", fontSize: 12.5 }}>
          {warning}
        </div>
      )}
      {expandedContent != null && open && (
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--line)", background: "var(--page)" }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}

/**
 * GroupCard — an origin-event group. One cohesive card: header (label, count,
 * channel chip, stamp, optional duplicate count, Approve-all) + a chevron that
 * reveals flat, hairline-divided child rows. No nested cards.
 */
export function GroupCard({
  icon, iconColor, label, channel, stamp, count, dupCount, actions, children, defaultOpen, onDismissAll, childCap,
}: {
  icon: IconName;
  iconColor: string;
  label: string;
  channel: Channel;
  stamp: string;
  count: number;
  dupCount?: number;
  actions: InboxAction[];
  children?: React.ReactNode;
  defaultOpen?: boolean;
  /** When the group is expanded, a "Dismiss all" appears at the bottom. */
  onDismissAll?: () => void;
  /** Show this many child rows; the rest reveal inline via "Show N more". */
  childCap?: number;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const ch = CHANNEL[channel];
  const items = React.Children.toArray(children);
  const cap = childCap ?? items.length;
  const visible = showAll ? items : items.slice(0, cap);
  const hidden = items.length - visible.length;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
        <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--page)", color: iconColor }}>
          <Icon name={icon} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: "var(--line)", color: "var(--muted)" }}>{count}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 5, color: ch.color, background: ch.bg }}>{ch.label}</span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{stamp}</span>
            {!!dupCount && dupCount > 0 && <DupPill label={`${dupCount} duplicate${dupCount === 1 ? "" : "s"}`} />}
          </div>
        </div>
        <ActionButtons actions={actions} />
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
          style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .12s" }}
        >
          <Icon name="chevron-down" size={16} />
        </button>
      </div>
      {open && (items.length > 0 || onDismissAll) && (
        <div>
          {visible}
          {hidden > 0 && <GroupMoreRow n={hidden} onClick={() => setShowAll(true)} />}
          {onDismissAll && (
            <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px" }}>
              <button
                onClick={onDismissAll}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
              >
                <Icon name="x" size={14} /> Dismiss all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A flat child row inside an expanded GroupCard (level two — no deeper nesting). */
export function GroupChildRow({
  title, meta, dup, actions,
}: {
  title: string;
  meta?: string;
  dup?: boolean;
  actions: InboxAction[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {dup && <DupPill />}
        </div>
        {meta && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>}
      </div>
      <ActionButtons actions={actions} />
    </div>
  );
}

/** "Show N more →" footer row inside an expanded group — routes overflow to the sheet. */
export function GroupMoreRow({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: "100%", textAlign: "left", padding: "12px 16px", borderTop: "1px solid var(--line)", background: "none", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--green)" }}
    >
      Show {n} more <Icon name="arrow-right" size={14} />
    </button>
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
