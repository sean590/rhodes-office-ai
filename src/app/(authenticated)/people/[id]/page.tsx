"use client";

/**
 * People record page (Phase 6b-2) — the unified per-person record. `?type`
 * (provider | directory) selects which record body to render; the registry and
 * the /service-providers/[id] redirect always supply it. Defaults to provider.
 */

import { use, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ProviderRecord } from "@/components/people/ProviderRecord";
import { DirectoryRecord } from "@/components/people/DirectoryRecord";

function RecordBody({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const type = sp.get("type");
  return type === "directory"
    ? <DirectoryRecord entryId={id} />
    : <ProviderRecord providerId={id} onDeleted={() => router.push("/people")} />;
}

export default function PersonRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <Link href="/people" style={{ fontSize: 13, color: "var(--green)", textDecoration: "none" }}>← People</Link>
      <Suspense fallback={<div style={{ color: "var(--faint)", marginTop: 12 }}>Loading…</div>}>
        <RecordBody id={id} />
      </Suspense>
    </div>
  );
}
