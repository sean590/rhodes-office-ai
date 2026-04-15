"use client";

import { useState } from "react";
import { BuildingIcon, ChartIcon, DocIcon, PeopleIcon, LinkIcon, GearIcon } from "@/components/ui/icons";

interface ActivityItem {
  id: string;
  action: string;
  resource_type: string;
  metadata: Record<string, unknown>;
  user_name: string | null;
  created_at: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ResourceIcon({ type, action }: { type: string; action: string }) {
  const size = 16;
  const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
    entity: { icon: <BuildingIcon size={size} color="#2d5a3d" />, color: "rgba(45,90,61,0.08)" },
    investment: { icon: <ChartIcon size={size} color="#7b4db5" />, color: "rgba(123,77,181,0.08)" },
    investment_allocation: { icon: <ChartIcon size={size} color="#3366a8" />, color: "rgba(51,102,168,0.08)" },
    investment_transaction: { icon: <ChartIcon size={size} color="#2d8a4e" />, color: "rgba(45,138,78,0.08)" },
    investment_co_investor: { icon: <ChartIcon size={size} color="#c47520" />, color: "rgba(196,117,32,0.08)" },
    investment_investor: { icon: <ChartIcon size={size} color="#7b4db5" />, color: "rgba(123,77,181,0.08)" },
    document: { icon: <DocIcon size={size} color="#3366a8" />, color: "rgba(51,102,168,0.08)" },
    pipeline: { icon: <DocIcon size={size} color="#3366a8" />, color: "rgba(51,102,168,0.08)" },
    pipeline_item: { icon: <DocIcon size={size} color="#3366a8" />, color: "rgba(51,102,168,0.08)" },
    directory_entry: { icon: <PeopleIcon size={size} color="#2d8a4e" />, color: "rgba(45,138,78,0.08)" },
    relationship: { icon: <LinkIcon size={size} color="#7b4db5" />, color: "rgba(123,77,181,0.08)" },
    cap_table_entry: { icon: <ChartIcon size={size} color="#3366a8" />, color: "rgba(51,102,168,0.08)" },
    compliance: { icon: <GearIcon size={size} color="#c47520" />, color: "rgba(196,117,32,0.08)" },
    compliance_obligation: { icon: <GearIcon size={size} color="#c47520" />, color: "rgba(196,117,32,0.08)" },
  };

  const match = iconMap[type] || { icon: <GearIcon size={size} color="#9494a0" />, color: "rgba(148,148,160,0.08)" };

  return (
    <div style={{
      width: 28, height: 28, borderRadius: 7,
      background: match.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {match.icon}
    </div>
  );
}

function fallbackTitle(entry: ActivityItem): string {
  const a = entry.action;
  const rt = entry.resource_type;
  const meta = entry.metadata || {};

  if (a === "create" && rt === "entity") return `Created entity: ${meta.name || meta.entity_name || ""}`;
  if (a === "edit" && rt === "entity") return `Updated entity${meta.entity_name ? `: ${meta.entity_name}` : ""}`;
  if (a === "delete" && rt === "entity") return `Deleted entity${meta.entity_name ? `: ${meta.entity_name}` : ""}`;
  if (a === "create" && rt === "investment") return `Created investment: ${meta.name || meta.investment_name || ""}`;
  if (a === "edit" && rt === "investment") return `Updated investment${meta.investment_name ? `: ${meta.investment_name}` : ""}`;
  if (a === "delete" && rt === "investment") return `Deleted investment${meta.investment_name ? `: ${meta.investment_name}` : ""}`;
  if (a === "create" && rt === "investment_transaction") {
    const txType = meta.transaction_type ? String(meta.transaction_type).replace(/_/g, " ") : "transaction";
    const amt = meta.amount ? `$${Number(meta.amount).toLocaleString()}` : "";
    return `Recorded ${txType}${amt ? ` of ${amt}` : ""}`;
  }
  if (a === "create" && rt === "investment_allocation") return `Updated allocations${meta.investment_name ? ` for ${meta.investment_name}` : ""}`;
  if (a === "upload" && rt === "document") return `Uploaded document: ${meta.document_name || ""}`;
  if (a === "upload" && rt === "pipeline") return `Uploaded ${meta.file_count || ""} document${(meta.file_count as number) !== 1 ? "s" : ""}`;
  if (a === "delete" && rt === "document") return `Deleted document: ${meta.document_name || ""}`;
  if (a === "download" && rt === "document") return `Downloaded: ${meta.name || meta.document_name || ""}`;
  if (a === "approve" && rt === "pipeline_item") return `Approved: ${meta.document_name || "document"}`;
  if (a === "ingest" && rt === "pipeline_item") return `Ingested: ${meta.document_name || "document"}`;
  if (a === "create" && rt === "directory_entry") return `Added to directory: ${meta.name || ""}`;
  if (a === "create" && rt === "relationship") return `Created relationship`;
  if (a === "create" && rt === "cap_table_entry") return `Added cap table entry: ${meta.investor_name || ""}`;

  return `${a.charAt(0).toUpperCase() + a.slice(1)} ${rt.replace(/_/g, " ")}`;
}

export function ActivityEntry({ entry }: { entry: ActivityItem }) {
  const meta = entry.metadata || {};
  const description = (meta.description as string) || fallbackTitle(entry);
  const changes = meta.changes as Array<{ field: string; from: unknown; to: unknown }> | undefined;
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      padding: "10px 16px",
      borderBottom: "1px solid #f0eee8",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ResourceIcon type={entry.resource_type} action={entry.action} />
        <span style={{ fontSize: 13, color: "#1a1a1f", flex: 1, lineHeight: 1.4 }}>{description}</span>
        {entry.user_name && (
          <span style={{ fontSize: 11, color: "#9494a0", flexShrink: 0 }}>{entry.user_name}</span>
        )}
        <span style={{ fontSize: 12, color: "#9494a0", flexShrink: 0, marginLeft: 4, whiteSpace: "nowrap" }}>
          {relativeTime(entry.created_at)}
        </span>
        {changes && changes.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 11, color: "#2d5a3d", background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}
          >
            {expanded ? "Hide" : "Details"}
          </button>
        )}
      </div>

      {expanded && changes && (
        <div style={{ marginTop: 6, marginLeft: 38, fontSize: 12, color: "#6b6b76" }}>
          {changes.map((c, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 500 }}>{c.field}:</span>{" "}
              <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{String(c.from ?? "(empty)")}</span>
              {" → "}
              <span style={{ color: "#1a1a1f" }}>{String(c.to ?? "(empty)")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
