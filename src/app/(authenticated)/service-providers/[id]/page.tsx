"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import type { ProviderContact } from "@/lib/types/entities";

const DISCIPLINE_LABELS: Record<string, string> = {
  tax: "Tax",
  bookkeeping: "Bookkeeping",
  legal: "Legal",
  valuation: "Valuation",
  wealth_mgmt: "Wealth Mgmt",
  registered_agent: "Registered Agent",
  trustee: "Trustee",
};
const disciplineLabel = (d: string) => DISCIPLINE_LABELS[d] ?? d;
const humanizeType = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

interface LearnedRoute {
  document_type: string;
  times_confirmed: number;
  last_sent_at: string | null;
}

interface ProviderDetail {
  id: string;
  name: string;
  disciplines: string[];
  domains: string[];
  contacts: ProviderContact[];
  default_contact_email: string | null;
  serves_all_entities: boolean;
  notes: string | null;
  entity_ids: string[];
  learned_routing: LearnedRoute[];
}

interface SendAccess {
  viewed: number;
  downloaded: number;
  last_downloaded_email: string | null;
  last_access_at: string | null;
}

interface SendRow {
  id: string;
  document_id: string;
  document_name: string | null;
  document_count: number;
  recipient_email: string;
  subject: string | null;
  status: "queued" | "sent" | "failed";
  delivery_provider: string | null;
  error: string | null;
  share_token: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  sent_at: string | null;
  created_at: string;
  access: SendAccess;
}

type LinkState = "active" | "expired" | "revoked" | "none";
function linkState(s: SendRow): LinkState {
  if (!s.share_token) return "none";
  if (s.revoked_at) return "revoked";
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  sent: { color: "#2d8a4e", bg: "#eef6f0" },
  queued: { color: "#c47520", bg: "#fbf3e8" },
  failed: { color: "#c73e3e", bg: "#fbe8e8" },
};

export default function ServiceProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isMobile = useIsMobile();
  const setPageContext = useSetPageContext();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPageContext({ page: "service_providers" });
  }, [setPageContext]);

  const fetchAll = useCallback(async () => {
    try {
      const [provRes, sendsRes, entRes] = await Promise.all([
        fetch(`/api/service-providers/${id}`),
        fetch(`/api/service-providers/${id}/sends`),
        fetch("/api/entities"),
      ]);
      if (provRes.ok) setProvider(await provRes.json());
      if (sendsRes.ok) setSends(await sendsRes.json());
      if (entRes.ok) {
        const ents = await entRes.json();
        const map: Record<string, string> = {};
        if (Array.isArray(ents)) for (const e of ents) map[e.id] = e.short_name || e.name;
        setEntityNames(map);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

  // "Doc name" or "Doc name +N more" for a bundle.
  const docLabel = (s: SendRow) => {
    const base = s.document_name || "Document";
    return s.document_count > 1 ? `${base} +${s.document_count - 1} more` : base;
  };

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const handleRevoke = async (sendId: string) => {
    if (!confirm("Revoke this secure link? It will immediately stop working.")) return;
    setRevokingId(sendId);
    try {
      const res = await fetch(`/api/provider-sends/${sendId}/revoke`, { method: "POST" });
      if (!res.ok) {
        alert("Failed to revoke");
        return;
      }
      await fetchAll();
    } catch {
      alert("Failed to revoke");
    } finally {
      setRevokingId(null);
    }
  };

  const activityText = (a: SendAccess) => {
    if (a.viewed === 0 && a.downloaded === 0) return "Not opened yet";
    const parts: string[] = [];
    if (a.viewed > 0) parts.push(`Viewed ${a.viewed}×`);
    if (a.downloaded > 0) {
      parts.push(`Downloaded ${a.downloaded}×${a.last_downloaded_email ? ` by ${a.last_downloaded_email}` : ""}`);
    }
    return parts.join(" · ");
  };

  const handleDelete = async () => {
    if (!provider) return;
    if (!confirm(`Delete provider "${provider.name}"? Past sends are retained.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/service-providers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Failed to delete");
        setDeleting(false);
        return;
      }
      router.push("/service-providers");
    } catch {
      alert("Failed to delete provider");
      setDeleting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "#9494a0",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 4,
  };
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
    verticalAlign: "middle",
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ color: "#9494a0", marginTop: 12 }}>Loading…</div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <Link href="/service-providers" style={{ fontSize: 13, color: "#2d5a3d" }}>← Providers</Link>
        <div style={{ color: "#9494a0", marginTop: 16 }}>Provider not found.</div>
      </div>
    );
  }

  const defaultRecipient =
    provider.default_contact_email || provider.contacts?.find((c) => c.is_default)?.email || "—";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <Link href="/service-providers" style={{ fontSize: 13, color: "#2d5a3d", textDecoration: "none" }}>← Providers</Link>

      {/* Header */}
      <div style={{ marginTop: 12, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "#1a1a1f", margin: 0 }}>{provider.name}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {(provider.disciplines ?? []).map((d) => (
              <Badge key={d} label={disciplineLabel(d)} color="#2d5a3d" bg="#eef3ef" />
            ))}
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            background: "none",
            border: "1px solid #f0d0d0",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: deleting ? "default" : "pointer",
            fontSize: 12,
            color: "#c73e3e",
            fontWeight: 500,
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {/* Info card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <div>
            <div style={labelStyle}>Domains</div>
            <div style={{ fontSize: 13, color: "#1a1a1f" }}>{(provider.domains ?? []).join(", ") || "—"}</div>
          </div>
          <div>
            <div style={labelStyle}>Default Recipient</div>
            <div style={{ fontSize: 13, color: "#1a1a1f" }}>{defaultRecipient}</div>
          </div>
          <div>
            <div style={labelStyle}>Entities Served</div>
            <div style={{ fontSize: 13, color: "#1a1a1f" }}>
              {provider.serves_all_entities
                ? "All entities"
                : provider.entity_ids.length === 0
                  ? "—"
                  : provider.entity_ids.map((eid) => entityNames[eid] || eid.slice(0, 8)).join(", ")}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Contacts</div>
            <div style={{ fontSize: 13, color: "#1a1a1f" }}>
              {(provider.contacts ?? []).length === 0
                ? "—"
                : provider.contacts.map((c) => `${c.name} (${c.email})`).join(", ")}
            </div>
          </div>
        </div>
        {provider.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={labelStyle}>Notes</div>
            <div style={{ fontSize: 13, color: "#1a1a1f", whiteSpace: "pre-wrap" }}>{provider.notes}</div>
          </div>
        )}
      </Card>

      {/* What Rhodes routes here (read-only transparency) */}
      <Card style={{ marginBottom: 16 }}>
        <SectionHeader>What Rhodes routes here</SectionHeader>
        {provider.learned_routing.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9494a0", padding: "8px 0" }}>
            Nothing learned yet — Rhodes picks this up as you send documents to {provider.name}.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {provider.learned_routing.map((r) => (
              <div
                key={r.document_type}
                style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: "8px 12px", background: "#faf9f6" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>{humanizeType(r.document_type)}</div>
                <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
                  sent {r.times_confirmed}× · last {fmtDate(r.last_sent_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Send history */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <SectionHeader>Sent ({sends.length})</SectionHeader>
        </div>
        {sends.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9494a0", padding: 16 }}>No documents sent to {provider.name} yet.</div>
        ) : isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
            {sends.map((s) => {
              const sc = STATUS_COLOR[s.status] ?? STATUS_COLOR.queued;
              return (
                <div key={s.id} style={{ border: "1px solid #f0eee8", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <Link href={`/api/documents/${s.document_id}/download`} style={{ fontSize: 13, fontWeight: 600, color: "#2d5a3d", textDecoration: "none" }}>
                      {docLabel(s)}
                    </Link>
                    <Badge label={s.status} color={sc.color} bg={sc.bg} />
                  </div>
                  <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>{s.recipient_email}</div>
                  <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>{fmtDate(s.created_at)} · {activityText(s.access)}</div>
                  {(() => {
                    const ls = linkState(s);
                    if (ls === "active") {
                      return (
                        <button onClick={() => handleRevoke(s.id)} disabled={revokingId === s.id}
                          style={{ marginTop: 6, background: "none", border: "1px solid #f0d0d0", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#c73e3e", fontFamily: "inherit", cursor: "pointer" }}>
                          {revokingId === s.id ? "Revoking…" : "Revoke link"}
                        </button>
                      );
                    }
                    if (ls === "revoked") return <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>Link revoked</div>;
                    if (ls === "expired") return <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>Link expired</div>;
                    return null;
                  })()}
                  {s.status === "failed" && s.error && (
                    <div style={{ fontSize: 11, color: "#c73e3e", marginTop: 4 }}>{s.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Document</th>
                <th style={thStyle}>Recipient</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Activity</th>
                <th style={thStyle}>Sent</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => {
                const sc = STATUS_COLOR[s.status] ?? STATUS_COLOR.queued;
                const ls = linkState(s);
                return (
                  <tr key={s.id}>
                    <td style={tdStyle}>
                      <Link href={`/api/documents/${s.document_id}/download`} style={{ color: "#2d5a3d", fontWeight: 500, textDecoration: "none" }}>
                        {docLabel(s)}
                      </Link>
                    </td>
                    <td style={{ ...tdStyle, color: "#6b6b76" }}>{s.recipient_email}</td>
                    <td style={tdStyle}>
                      <Badge label={s.status} color={sc.color} bg={sc.bg} />
                      {s.status === "failed" && s.error && (
                        <span style={{ fontSize: 11, color: "#c73e3e", marginLeft: 8 }}>{s.error}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "#6b6b76", fontSize: 12 }}>{activityText(s.access)}</td>
                    <td style={{ ...tdStyle, color: "#6b6b76", whiteSpace: "nowrap" }}>{fmtDate(s.created_at)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      {ls === "active" ? (
                        <button onClick={() => handleRevoke(s.id)} disabled={revokingId === s.id}
                          style={{ background: "none", border: "1px solid #f0d0d0", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#c73e3e", fontFamily: "inherit", cursor: "pointer" }}>
                          {revokingId === s.id ? "Revoking…" : "Revoke"}
                        </button>
                      ) : ls === "revoked" ? (
                        <span style={{ fontSize: 11, color: "#9494a0" }}>Revoked</span>
                      ) : ls === "expired" ? (
                        <span style={{ fontSize: 11, color: "#9494a0" }}>Expired</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#c9c7bf" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
