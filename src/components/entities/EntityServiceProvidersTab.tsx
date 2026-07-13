"use client";

/**
 * EntityServiceProvidersTab
 *
 * The "Providers" tab on the entity detail page — the mirror of the
 * provider→entities view. Lists the service-provider firms that serve THIS
 * entity (either explicitly linked or marked serves_all_entities), each linking
 * to the provider detail page. A lightweight overview, not an editor; linking is
 * managed from the Providers page.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

interface ProviderRow {
  id: string;
  name: string;
  disciplines: string[];
  default_contact_email: string | null;
  contacts: ProviderContact[];
  serves_all_entities: boolean;
  entity_ids: string[];
}

export function EntityServiceProvidersTab({ entityId }: { entityId: string; entityName: string }) {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/service-providers");
      if (res.ok) {
        const all: ProviderRow[] = await res.json();
        // Serving this entity = all-entities firm OR an explicit entity link.
        setProviders(all.filter((p) => p.serves_all_entities || (p.entity_ids ?? []).includes(entityId)));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  if (loading) {
    return <div style={{ color: "#9494a0", fontSize: 13, padding: "12px 0" }}>Loading…</div>;
  }

  if (providers.length === 0) {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "28px 0", color: "#9494a0", fontSize: 14 }}>
          No service providers serve this entity yet.{" "}
          <Link href="/people" style={{ color: "#2d5a3d" }}>
            Manage providers
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {providers.map((p, i) => {
          const recipient = p.default_contact_email || p.contacts?.find((c) => c.is_default)?.email || null;
          return (
            <Link
              key={p.id}
              href={`/people/${p.id}?type=provider`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderTop: i === 0 ? "none" : "1px solid #f0eee8",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>{p.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {(p.disciplines ?? []).map((d) => (
                    <Badge key={d} label={disciplineLabel(d)} color="#2d5a3d" bg="#eef3ef" />
                  ))}
                  {p.serves_all_entities && (
                    <Badge label="All entities" color="#6b6b76" bg="#f0eee8" />
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#6b6b76", whiteSpace: "nowrap" }}>{recipient || ""}</div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
