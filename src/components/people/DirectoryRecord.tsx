"use client";

/**
 * DirectoryRecord — the per-person record body for a Directory contact on the
 * unified People record page (/people/[id]?type=directory). Shows the contact's
 * details and their enumerated roles across the org's entities (manager,
 * member, trustee, cap-table holder…), each linking to the entity.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

type DirectoryEntryType = "individual" | "external_entity" | "trust";

interface Role { kind: string; entity_id: string; entity_name: string }
interface DirectoryDetail {
  id: string; name: string; type: DirectoryEntryType; email: string | null; aliases: string[]; roles: Role[];
}

const KIND_LABEL: Record<DirectoryEntryType, { label: string; color: string; bg: string }> = {
  individual: { label: "Person", color: "var(--green)", bg: "var(--green-50)" },
  external_entity: { label: "Company", color: "var(--blue)", bg: "var(--blue-50)" },
  trust: { label: "Trust", color: "var(--purple)", bg: "var(--purple-50)" },
};

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };

export function DirectoryRecord({ entryId }: { entryId: string }) {
  const [entry, setEntry] = useState<DirectoryDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/directory/${entryId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) setEntry(d); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entryId]);

  if (loading) return <div style={{ color: "var(--faint)", marginTop: 12 }}>Loading…</div>;
  if (!entry) return <div style={{ color: "var(--faint)", marginTop: 16 }}>Contact not found.</div>;

  const kind = KIND_LABEL[entry.type] ?? KIND_LABEL.individual;

  return (
    <>
      <div style={{ marginTop: 12, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", margin: 0 }}>{entry.name}</h1>
          <Badge label={kind.label} color={kind.color} bg={kind.bg} />
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div><div style={labelStyle}>Email</div><div style={{ fontSize: 13, color: "var(--ink)" }}>{entry.email || "—"}</div></div>
          <div><div style={labelStyle}>Also known as</div><div style={{ fontSize: 13, color: "var(--ink)" }}>{entry.aliases.length ? entry.aliases.join(", ") : "—"}</div></div>
        </div>
      </Card>

      <Card>
        <SectionHeader>Roles across your entities</SectionHeader>
        {entry.roles.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--faint)", padding: "8px 0" }}>
            Not referenced in any entity yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {entry.roles.map((r, i) => (
              <div key={`${r.kind}-${r.entity_id}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "var(--muted)", minWidth: 130 }}>{r.kind}</span>
                <Link href={`/entities/${r.entity_id}`} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--green)", textDecoration: "none" }}>{r.entity_name}</Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
