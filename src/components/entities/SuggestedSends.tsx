"use client";

/**
 * "Suggested sends" — the proactive routing surface. Lazily fetches grouped
 * bundle suggestions (recent documents → providers that should receive them)
 * and lets the user Approve (opens a prefilled bundle send card) or Dismiss
 * (won't resurface; decays the rule). Quiet by design: renders nothing when
 * there's nothing to suggest.
 */

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SendToProviderCard } from "@/components/entities/SendToProviderCard";

interface SuggestionDoc {
  id: string;
  name: string;
  document_type: string | null;
}

interface SendSuggestion {
  provider: { id: string; name: string; disciplines: string[] };
  recommended_recipient_email: string | null;
  documents: SuggestionDoc[];
  learned: boolean;
}

export function SuggestedSends({
  onSent,
  onCount,
  bare = false,
}: {
  onSent?: () => void;
  /** Reports the number of loaded suggestions (e.g. for a lane badge). */
  onCount?: (n: number) => void;
  /** Skip the outer "Suggested sends" card chrome (used inside the Home lane). */
  bare?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<SendSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-sends/suggestions");
      if (res.ok) {
        const data: SendSuggestion[] = await res.json();
        setSuggestions(data);
        onCount?.(data.length);
      }
    } catch (err) {
      console.error("SuggestedSends load error:", err);
    } finally {
      setLoaded(true);
    }
  }, [onCount]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const dismiss = async (s: SendSuggestion) => {
    setBusyProviderId(s.provider.id);
    try {
      const res = await fetch("/api/provider-sends/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: s.provider.id, document_ids: s.documents.map((d) => d.id) }),
      });
      if (res.ok) setSuggestions((prev) => prev.filter((x) => x.provider.id !== s.provider.id));
    } catch (err) {
      console.error(err);
    } finally {
      setBusyProviderId(null);
    }
  };

  // Quiet: nothing to suggest → render nothing.
  if (!loaded || suggestions.length === 0) return null;

  const list = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s) => {
          const n = s.documents.length;
          const isOpen = openProviderId === s.provider.id;
          return (
            <div key={s.provider.id} style={{ border: "1px solid #e8e6df", borderRadius: 8, background: "#fff", padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#1a1a1f" }}>
                    Send <strong>{n} document{n === 1 ? "" : "s"}</strong> to <strong>{s.provider.name}</strong>
                    {s.recommended_recipient_email ? <span style={{ color: "#6b6b76" }}> ({s.recommended_recipient_email})</span> : null}
                    {s.learned ? <span style={{ marginLeft: 6, fontSize: 11, color: "#2d8a4e" }}>★ learned</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>
                    {s.documents.slice(0, 3).map((d) => d.name).join(" · ")}
                    {n > 3 ? ` · +${n - 3} more` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Button variant="primary" onClick={() => setOpenProviderId(isOpen ? null : s.provider.id)}>
                    {isOpen ? "Hide" : "Review & send"}
                  </Button>
                  <Button onClick={() => dismiss(s)} disabled={busyProviderId === s.provider.id}>
                    {busyProviderId === s.provider.id ? "…" : "Dismiss"}
                  </Button>
                </div>
              </div>

              {isOpen && (
                <SendToProviderCard
                  documents={s.documents.map((d) => ({ id: d.id, name: d.name }))}
                  initialProviderId={s.provider.id}
                  onSubmitted={() => {
                    setSuggestions((prev) => prev.filter((x) => x.provider.id !== s.provider.id));
                    setOpenProviderId(null);
                    onSent?.();
                  }}
                  onClose={() => setOpenProviderId(null)}
                />
              )}
            </div>
          );
        })}
    </div>
  );

  if (bare) return list;

  return (
    <Card style={{ marginBottom: 20, border: "1px solid #d7e3da", background: "#f7faf8" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--green)", marginBottom: 4 }}>Suggested sends</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        Documents Rhodes thinks should go to a provider. Review before anything is sent.
      </div>
      {list}
    </Card>
  );
}
