"use client";

/**
 * Email source attribution for document lists (rhodes-inbound-v1-ui-spec §2).
 * A document is email-sourced iff its id appears in an inbound delivery's
 * document_ids. The chip reads "{Provider} · email" — sender domain when no
 * provider matched, bare "email" when neither is known — and clicks through to
 * the mailbox ledger (Settings → Mailbox): provenance in one click.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

export interface EmailSource {
  /** Who it came from: provider display name, else sender domain, else null. */
  from: string | null;
  subject: string | null;
}

/**
 * doc_id → email source, from one no-store fetch of the mailbox feed per page
 * (plus the provider list, for display names — never a raw UUID). Empty until
 * loaded; failures are non-fatal — rows simply render without a chip.
 */
export function useEmailSources(): Map<string, EmailSource> {
  const [sources, setSources] = useState<Map<string, EmailSource>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const noStore = { cache: "no-store" as const };
        const [inRes, pRes] = await Promise.all([
          fetch("/api/inbound?limit=200", noStore),
          fetch("/api/service-providers", noStore).catch(() => null),
        ]);
        if (!inRes.ok) return;
        const providerNames = new Map<string, string>();
        if (pRes?.ok) {
          const providers: Array<{ id: string; name: string }> = await pRes.json();
          for (const p of Array.isArray(providers) ? providers : []) providerNames.set(p.id, p.name);
        }
        const rows: Array<{
          sender: string | null;
          subject: string | null;
          provider_id: string | null;
          document_ids: string[] | null;
        }> = await inRes.json();
        const map = new Map<string, EmailSource>();
        for (const r of Array.isArray(rows) ? rows : []) {
          const domain = r.sender?.match(/@([A-Za-z0-9.-]+)/)?.[1]?.toLowerCase() ?? null;
          const from = (r.provider_id ? providerNames.get(r.provider_id) : undefined) ?? domain;
          for (const id of r.document_ids ?? []) map.set(id, { from, subject: r.subject });
        }
        if (!cancelled) setSources(map);
      } catch {
        /* non-fatal — rows just render without a source chip */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return sources;
}

/** Teal "{Provider} · email" pill (channel-chip family); links to the mailbox ledger. */
export function EmailSourceChip({ source }: { source: EmailSource }) {
  return (
    <Link
      href="/settings/mailbox"
      onClick={(e) => e.stopPropagation()}
      title={source.subject ? `Arrived by email — "${source.subject}"` : "Arrived by email"}
      style={{
        fontSize: 10, fontWeight: 600, color: "var(--teal)", background: "var(--teal-50)",
        padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap", textDecoration: "none", flexShrink: 0,
      }}
    >
      {source.from ? `${source.from} · email` : "email"}
    </Link>
  );
}
