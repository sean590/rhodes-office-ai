"use client";

/**
 * Settings → Automation → Mailbox — the one net-new inbound surface
 * (rhodes-inbound-v1-ui-spec.md §3). Connection card (address + health +
 * counters), recent activity (outcome rows only, human sentences), and the
 * collapsed skipped-mail count with the "This is a delivery" teach action
 * (§3c, Increment 3): reprocesses the message and learns the sender.
 */

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";
import { formatStamp } from "@/lib/format-time";
import { INBOUND_ADDRESS, needsUserReasonSentence } from "@/lib/inbound/copy";
// The displayed address is the CONNECTION'S OWN identity (Gmail profile,
// recorded each poll) — the config const is only the pre-first-poll fallback.

interface Health {
  status: "connected" | "problem" | "not_connected";
  last_success_at: string | null;
  mailbox_address: string | null;
  last_error: string | null;
  counters: { emails_this_month: number; documents_filed: number; waiting_on_you: number };
}

interface InboundDoc {
  id: string;
  name?: string;
  status?: string;
}

interface InboundRow {
  id: string;
  sender: string | null;
  subject: string | null;
  received_at: string;
  classification: string | null;
  status: string;
  document_ids: string[] | null;
  needs_user_reason: string | null;
  error: string | null;
  documents: InboundDoc[];
}

// Outcome dispositions only — anything mid-flight (pending/processing) or
// ignored never renders as an activity row.
const OUTCOME_STATUSES = new Set([
  "ingested",
  "retrieved",
  "needs_user",
  "acknowledged",
  "resolved",
  "dismissed",
  "failed",
]);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function DocLinks({ docs }: { docs: InboundDoc[] }) {
  return (
    <>
      {docs.map((d, i) => (
        <React.Fragment key={d.id}>
          {i > 0 && ", "}
          <Link
            href={`/api/documents/${d.id}/download`}
            style={{ color: "#2d5a3d", fontWeight: 500, textDecoration: "none" }}
          >
            {d.name || "Document"}
          </Link>
        </React.Fragment>
      ))}
    </>
  );
}

// Chip + sentence for an outcome row. Sentences with links, never enums.
function Disposition({ row }: { row: InboundRow }) {
  const docs = row.documents ?? [];
  const sub: React.CSSProperties = { fontSize: 12, color: "#6b6b76", marginTop: 4, lineHeight: 1.5 };

  switch (row.status) {
    case "ingested":
      return (
        <div>
          <Chip label="Filed" color="#2d8a4e" bg="#eef6f0" />
          <div style={sub}>
            {docs.length || row.document_ids?.length || 1} attachment
            {(docs.length || row.document_ids?.length || 1) === 1 ? "" : "s"}
            {docs.length > 0 && (
              <>
                {" → "}
                <DocLinks docs={docs} />
              </>
            )}
          </div>
        </div>
      );
    case "retrieved":
      return (
        <div>
          <Chip label="Retrieved via secure link" color="#2d5a3d" bg="#eef3ef" />
          <div style={sub}>
            {docs.length || row.document_ids?.length || 1} document
            {(docs.length || row.document_ids?.length || 1) === 1 ? "" : "s"} filed
            {docs.length > 0 && (
              <>
                {" → "}
                <DocLinks docs={docs} />
              </>
            )}
          </div>
        </div>
      );
    case "needs_user":
      return (
        <div>
          <Chip label="Needs you" color="#c47520" bg="#fbf3e8" />
          <div style={sub}>
            {needsUserReasonSentence(row.needs_user_reason)}{" "}
            <Link href="/home" style={{ color: "#2d5a3d", fontWeight: 500, textDecoration: "none" }}>
              Open in Home →
            </Link>
          </div>
        </div>
      );
    case "acknowledged":
      return (
        <div>
          <Chip label="Waiting" color="#9494a0" bg="#f0eee8" />
          <div style={sub}>
            You forwarded it — waiting for it to arrive.{" "}
            <Link href="/home" style={{ color: "#2d5a3d", fontWeight: 500, textDecoration: "none" }}>
              Open in Home →
            </Link>
          </div>
        </div>
      );
    case "resolved":
      return (
        <div>
          <Chip label="Filed" color="#2d8a4e" bg="#eef6f0" />
          <div style={sub}>
            The document made it in
            {docs.length > 0 ? (
              <>
                {" → "}
                <DocLinks docs={docs} />
              </>
            ) : (
              "."
            )}
          </div>
        </div>
      );
    case "dismissed":
      return (
        <div>
          <Chip label="Dismissed" color="#9494a0" bg="#f0eee8" />
          <div style={sub}>You dismissed this — Rhodes won&apos;t ask again.</div>
        </div>
      );
    case "failed":
      return (
        <div>
          <Chip label="Couldn't file" color="#c73e3e" bg="#fbe8e8" />
          <div style={sub}>
            Rhodes couldn&apos;t file this one.
            {row.error && <span style={{ color: "#9494a0" }}> {row.error}</span>}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export default function SettingsMailboxPage() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [activity, setActivity] = useState<InboundRow[]>([]);
  const [skipped, setSkipped] = useState<InboundRow[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSkips, setShowSkips] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [teachingId, setTeachingId] = useState<string | null>(null);
  // Per-row inline confirmation/error after the teach action.
  const [teachNotes, setTeachNotes] = useState<Record<string, { text: string; ok: boolean }>>({});

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/inbound/health");
      if (res.ok) setHealth(await res.json());
    } catch {
      /* non-critical */
    }
  }, []);

  const fetchRows = useCallback(async () => {
    try {
      const [actRes, allRes] = await Promise.all([
        fetch("/api/inbound?limit=100"),
        fetch("/api/inbound?include_ignored=true&limit=200"),
      ]);
      if (actRes.ok) {
        const rows: InboundRow[] = await actRes.json();
        const outcomes = rows.filter((r) => OUTCOME_STATUSES.has(r.status));
        // needs_user pins to top; everything else keeps newest-first order.
        setActivity([
          ...outcomes.filter((r) => (r.status === "needs_user" || r.status === "waiting_code")),
          ...outcomes.filter((r) => r.status !== "needs_user"),
        ]);
      }
      if (allRes.ok) {
        const rows: InboundRow[] = await allRes.json();
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        setSkipped(
          rows.filter((r) => r.status === "ignored" && new Date(r.received_at).getTime() >= cutoff),
        );
      }
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([
        fetchHealth(),
        fetchRows(),
        fetch("/api/auth/me")
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.email && !cancelled) setMyEmail(String(data.email).toLowerCase());
          })
          .catch(() => {}),
      ]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchHealth, fetchRows]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleCheckAgain = async () => {
    setChecking(true);
    await fetchHealth();
    setChecking(false);
  };

  const handleDismiss = async (id: string) => {
    setDismissingId(id);
    try {
      await fetch(`/api/inbound/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismissed" }),
      });
      await Promise.all([fetchRows(), fetchHealth()]);
    } catch {
      /* row stays; user can retry */
    }
    setDismissingId(null);
  };

  // "This is a delivery" (spec §3c): reprocess + learn the sender. Confirmation
  // shows inline, then the refetch clears the row out of the skipped list.
  const handleTeach = async (id: string) => {
    setTeachingId(id);
    try {
      const res = await fetch(`/api/inbound/${id}/reprocess`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTeachNotes((n) => ({ ...n, [id]: { text: "Reprocessing — sender learned.", ok: true } }));
        setTimeout(() => {
          void Promise.all([fetchRows(), fetchHealth()]);
        }, 1500);
      } else {
        setTeachNotes((n) => ({
          ...n,
          [id]: { text: data?.error || "Couldn't reprocess this one — try again.", ok: false },
        }));
      }
    } catch {
      setTeachNotes((n) => ({ ...n, [id]: { text: "Couldn't reprocess this one — try again.", ok: false } }));
    }
    setTeachingId(null);
  };

  if (loading) {
    return (
      <div style={{ padding: 80, color: "#9494a0", fontSize: 13, textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  const status = health?.status ?? "not_connected";
  const address = health?.mailbox_address || INBOUND_ADDRESS;
  const isForwarded = (sender: string | null) =>
    !!myEmail && !!sender && sender.toLowerCase() === myEmail;

  const healthChip =
    status === "connected" ? (
      <Chip
        label={
          health?.last_success_at
            ? `Connected · checked ${formatStamp(health.last_success_at)}`
            : "Connected"
        }
        color="#2d8a4e"
        bg="#eef6f0"
      />
    ) : status === "problem" ? (
      <Chip label="Connection problem" color="#c47520" bg="#fbf3e8" />
    ) : (
      <Chip label="Not connected" color="#6b6b76" bg="#f0eee8" />
    );

  const thStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#9494a0",
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: "1px solid #e8e6df",
  };
  const tdStyle: React.CSSProperties = {
    padding: "12px",
    borderBottom: "1px solid #f0eee8",
    fontSize: 13,
    verticalAlign: "top",
  };

  const fromCell = (row: InboundRow) => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
        {isForwarded(row.sender) ? (
          <>
            You <span style={{ fontWeight: 400, color: "#9494a0" }}>(forwarded)</span>
          </>
        ) : (
          row.sender || "Unknown sender"
        )}
      </div>
      {row.subject && (
        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>&ldquo;{row.subject}&rdquo;</div>
      )}
    </>
  );

  const canDismiss = (row: InboundRow) =>
    row.status === "needs_user" || row.status === "acknowledged" || row.status === "failed";

  const dismissButton = (row: InboundRow) => (
    <button
      onClick={() => handleDismiss(row.id)}
      disabled={dismissingId === row.id}
      title="Dismiss"
      aria-label="Dismiss"
      style={{
        background: "none",
        border: "none",
        color: "#9494a0",
        fontSize: 15,
        lineHeight: 1,
        cursor: dismissingId === row.id ? "default" : "pointer",
        padding: "2px 6px",
        fontFamily: "inherit",
      }}
    >
      ×
    </button>
  );

  const subduedRow = (row: InboundRow) =>
    row.status === "acknowledged" || row.status === "dismissed";

  // The one skipped-row action (spec §3c) — or its inline confirmation/error.
  const teachControl = (row: InboundRow) => {
    const note = teachNotes[row.id];
    if (note) {
      return (
        <span style={{ fontSize: 12, fontWeight: 500, color: note.ok ? "#2d5a3d" : "#c47520" }}>
          {note.text}
        </span>
      );
    }
    return (
      <button
        onClick={() => handleTeach(row.id)}
        disabled={teachingId === row.id}
        style={{
          background: "none",
          border: "1px solid #e8e6df",
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 600,
          color: teachingId === row.id ? "#9494a0" : "#2d5a3d",
          cursor: teachingId === row.id ? "default" : "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        {teachingId === row.id ? "Reprocessing..." : "This is a delivery"}
      </button>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <h1
          style={{
            fontSize: isMobile ? 20 : 22,
            fontWeight: 600,
            color: "#1a1a1f",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Mailbox
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Rhodes&apos; email address, its connection, and what arrived
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
        {/* ---- Connection card (spec §3a) ---- */}
        <SectionCard
          title="Rhodes mailbox"
          subtitle="Providers send here — or you forward here — and Rhodes files what arrives."
          isMobile={isMobile}
          headerRight={healthChip}
        >
          {status === "not_connected" ? (
            <div>
              <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                Once connected, Rhodes gets its own email address. Give it to your providers —
                or forward document emails to it — and everything that arrives is filed for you.
              </p>
              <button
                onClick={handleCheckAgain}
                disabled={checking}
                style={{
                  background: checking ? "#e8e6df" : "#2d5a3d",
                  color: checking ? "#9494a0" : "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: checking ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {checking ? "Checking..." : "Connect"}
              </button>
            </div>
          ) : (
            <>
              {status === "problem" && (
                <div
                  style={{
                    padding: "10px 12px",
                    marginBottom: 12,
                    background: "#fbf3e8",
                    border: "1px solid rgba(196,117,32,0.25)",
                    borderRadius: 8,
                    fontSize: 12.5,
                    color: "#6b6b76",
                    lineHeight: 1.5,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 200 }}>
                    Rhodes can&apos;t check the mailbox right now. Mail isn&apos;t lost — it&apos;ll
                    catch up as soon as the connection is restored.
                  </span>
                  <button
                    onClick={handleCheckAgain}
                    disabled={checking}
                    style={{
                      background: "none",
                      border: "1px solid rgba(196,117,32,0.4)",
                      borderRadius: 6,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#c47520",
                      cursor: checking ? "default" : "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {checking ? "Checking..." : "Check again"}
                  </button>
                </div>
              )}

              {/* Address box */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "#faf9f6",
                  border: "1px solid #e8e6df",
                  borderRadius: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9494a0",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Your address
                </span>
                <code
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "#1a1a1f",
                    background: "none",
                    wordBreak: "break-all",
                  }}
                >
                  {address}
                </code>
                <button
                  onClick={handleCopy}
                  style={{
                    background: copied ? "rgba(45,90,61,0.08)" : "none",
                    border: "1px solid #e8e6df",
                    borderRadius: 6,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: copied ? "#2d5a3d" : "#6b6b76",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              {/* Counters */}
              <div
                style={{
                  fontSize: 12.5,
                  color: "#6b6b76",
                  marginTop: 12,
                  display: "flex",
                  gap: 18,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <b style={{ color: "#1a1a1f", fontWeight: 600 }}>
                    {health?.counters.emails_this_month ?? 0}
                  </b>{" "}
                  emails this month
                </span>
                <span>
                  <b style={{ color: "#1a1a1f", fontWeight: 600 }}>
                    {health?.counters.documents_filed ?? 0}
                  </b>{" "}
                  documents filed
                </span>
                <span>
                  <b style={{ color: "#1a1a1f", fontWeight: 600 }}>
                    {health?.counters.waiting_on_you ?? 0}
                  </b>{" "}
                  waiting on you
                </span>
              </div>
            </>
          )}
        </SectionCard>

        {/* ---- Recent activity (spec §3b) ---- */}
        <SectionCard
          title="Recent activity"
          subtitle="What arrived and what Rhodes did with it. Older history lives on each document."
          isMobile={isMobile}
        >
          {activity.length === 0 ? (
            <div style={{ padding: "16px 0", fontSize: 13, color: "#9494a0" }}>
              Nothing has arrived yet. Give out {address} — or forward a document email
              to it — and it&apos;ll show up here.
            </div>
          ) : isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activity.map((row) => (
                <div
                  key={row.id}
                  style={{
                    border: "1px solid #f0eee8",
                    borderRadius: 8,
                    padding: 12,
                    opacity: subduedRow(row) ? 0.65 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <div>{fromCell(row)}</div>
                    {canDismiss(row) && dismissButton(row)}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Disposition row={row} />
                  </div>
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 6 }}>
                    {formatStamp(row.received_at)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ border: "1px solid #f0eee8", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: "34%" }}>From</th>
                    <th style={thStyle}>What happened</th>
                    <th style={{ ...thStyle, width: 130 }}>Received</th>
                    <th style={{ ...thStyle, width: 36 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {activity.map((row) => (
                    <tr key={row.id} style={{ opacity: subduedRow(row) ? 0.65 : 1 }}>
                      <td style={tdStyle}>{fromCell(row)}</td>
                      <td style={tdStyle}>
                        <Disposition row={row} />
                      </td>
                      <td style={{ ...tdStyle, color: "#6b6b76", whiteSpace: "nowrap", fontSize: 12 }}>
                        {formatStamp(row.received_at)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {canDismiss(row) && dismissButton(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- Skipped mail (spec §3c) ---- */}
          {skipped.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div
                onClick={() => setShowSkips((s) => !s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  color: "#6b6b76",
                  cursor: "pointer",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Rhodes also skipped{" "}
                  <b style={{ fontWeight: 600, color: "#1a1a1f" }}>
                    {skipped.length} email{skipped.length === 1 ? "" : "s"}
                  </b>{" "}
                  that weren&apos;t document deliveries
                </span>
                <span style={{ color: "#2d5a3d", fontWeight: 500 }}>
                  · {showSkips ? "Hide" : "Show recent"}
                </span>
              </div>

              {showSkips && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ border: "1px solid #f0eee8", borderRadius: 10, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {skipped.map((row) => (
                          <tr key={row.id}>
                            <td style={{ ...tdStyle, width: isMobile ? "auto" : "34%" }}>
                              {fromCell(row)}
                              {isMobile && row.sender && (
                                <div style={{ marginTop: 8 }}>{teachControl(row)}</div>
                              )}
                            </td>
                            {!isMobile && (
                              <td style={{ ...tdStyle, color: "#6b6b76", fontSize: 12 }}>
                                Didn&apos;t look like a document delivery
                                {row.sender && (
                                  <div style={{ marginTop: 6 }}>{teachControl(row)}</div>
                                )}
                              </td>
                            )}
                            <td
                              style={{
                                ...tdStyle,
                                color: "#9494a0",
                                whiteSpace: "nowrap",
                                fontSize: 12,
                                width: isMobile ? "auto" : 130,
                              }}
                            >
                              {formatStamp(row.received_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 12, color: "#9494a0", marginTop: 8 }}>
                    Skipped mail is kept for 30 days, then forgotten. Marking one as a
                    delivery reprocesses it — and teaches Rhodes to recognize that sender
                    from now on.
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: "#9494a0", marginTop: 14 }}>
            Rhodes never replies from this mailbox and never follows links from senders it
            doesn&apos;t recognize.
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
