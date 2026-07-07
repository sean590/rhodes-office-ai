"use client";

/**
 * Send-to-provider card. Sends one OR MORE documents to a service provider as a
 * single secure link (one email, one share page). Opens from a single document
 * row or from the Documents-tab multi-select. Previews via StagedActionsList and
 * posts to /api/provider-sends.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { StagedActionsList } from "@/components/shared/StagedActionsList";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/authz/role-provider";

interface ProviderContact {
  name: string;
  email: string;
  role?: string;
  is_default?: boolean;
}

interface ProviderResponse {
  id: string;
  name: string;
  default_contact_email: string | null;
  contacts: ProviderContact[];
  serves_all_entities: boolean;
  entity_ids: string[];
}

interface Suggestion {
  provider: ProviderResponse;
  matched_via: "entity" | "all_entities";
  recommended_recipient_email: string | null;
  relevant: boolean;
}

interface SendDoc {
  id: string;
  name: string;
}

interface Props {
  documents: SendDoc[];
  /** Pre-select this provider (e.g. when approving a Suggested send). */
  initialProviderId?: string;
  onSubmitted?: () => void;
  onClose: () => void;
}

function defaultRecipient(p: ProviderResponse | undefined): string {
  if (!p) return "";
  if (p.default_contact_email?.trim()) return p.default_contact_email.trim();
  const dflt = p.contacts?.find((c) => c.is_default && c.email?.trim());
  if (dflt) return dflt.email.trim();
  const first = p.contacts?.find((c) => c.email?.trim());
  return first ? first.email.trim() : "";
}

export function SendToProviderCard({ documents, initialProviderId, onSubmitted, onClose }: Props) {
  const canSend = useCan("providers:send");
  const [providers, setProviders] = useState<ProviderResponse[]>([]);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [relevantIds, setRelevantIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [providerId, setProviderId] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [recipientTouched, setRecipientTouched] = useState(false);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ status: string; error?: string } | null>(null);

  const primaryId = documents[0]?.id;
  const docCount = documents.length;

  // Load providers + suggestions for the primary document's entity.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [provRes, sugRes] = await Promise.all([
          fetch("/api/service-providers"),
          primaryId
            ? fetch(`/api/documents/${primaryId}/provider-suggestions`).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const provData: ProviderResponse[] = provRes.ok ? await provRes.json() : [];
        setProviders(provData);

        let firstId = provData[0]?.id ?? "";
        if (sugRes && sugRes.ok) {
          const suggestions: Suggestion[] = await sugRes.json();
          const ids = suggestions.map((s) => s.provider.id);
          setSuggestedIds(ids);
          setRelevantIds(new Set(suggestions.filter((s) => s.relevant).map((s) => s.provider.id)));
          // Prefer the first discipline-relevant suggestion, else first suggestion.
          firstId = suggestions.find((s) => s.relevant)?.provider.id ?? ids[0] ?? firstId;
        }
        // An explicit initial provider (approving a Suggested send) wins.
        if (initialProviderId && provData.some((p) => p.id === initialProviderId)) {
          firstId = initialProviderId;
        }
        if (firstId) {
          setProviderId(firstId);
          setRecipient(defaultRecipient(provData.find((p) => p.id === firstId)));
        }
      } catch (err) {
        console.error("SendToProviderCard load error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryId, initialProviderId]);

  const selectProvider = useCallback(
    (id: string) => {
      setProviderId(id);
      if (!recipientTouched) setRecipient(defaultRecipient(providers.find((p) => p.id === id)));
    },
    [providers, recipientTouched],
  );

  const selectedProvider = providers.find((p) => p.id === providerId);

  const orderedProviders = useMemo(() => {
    if (suggestedIds.length === 0) return providers;
    const sug = suggestedIds.map((id) => providers.find((p) => p.id === id)).filter((p): p is ProviderResponse => !!p);
    const rest = providers.filter((p) => !suggestedIds.includes(p.id));
    return [...sug, ...rest];
  }, [providers, suggestedIds]);

  const docLabel = docCount === 1 ? `"${documents[0]?.name}"` : `${docCount} documents`;

  const pendingAction = useMemo(
    () => ({
      id: "send-preview",
      tool: "send_document_to_provider",
      summary: selectedProvider
        ? `Send ${docLabel} to ${selectedProvider.name}${recipient ? ` (${recipient})` : ""}`
        : "Pick a provider to send to",
    }),
    [selectedProvider, docLabel, recipient],
  );

  const handleSend = async () => {
    if (!providerId || !recipient.trim() || documents.length === 0) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/provider-sends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_ids: documents.map((d) => d.id),
          provider_id: providerId,
          recipient_email: recipient.trim(),
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ status: "failed", error: data.error || "Send failed" });
        return;
      }
      setResult({ status: data.status, error: data.error });
      if (data.status === "sent") onSubmitted?.();
    } catch (err) {
      setResult({ status: "failed", error: err instanceof Error ? err.message : "Send failed" });
    } finally {
      setSending(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#6b6b76",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
  const inputStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  const sent = result?.status === "sent";

  return (
    <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#2d5a3d" }}>
          Send {docCount === 1 ? "to provider" : `${docCount} documents to provider`}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#9494a0", fontFamily: "inherit" }}>Close</button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: "#9494a0" }}>Loading providers…</div>
      ) : providers.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9494a0" }}>No service providers yet. Add one on the Providers page first.</div>
      ) : sent ? (
        <div style={{ fontSize: 13, color: "#2d8a4e" }}>
          ✓ Sent a secure link for {docLabel} to {selectedProvider?.name} ({recipient}).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Documents in this send */}
          {docCount > 1 && (
            <div>
              <label style={labelStyle}>Documents ({docCount})</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 120, overflowY: "auto" }}>
                {documents.map((d) => (
                  <div key={d.id} style={{ fontSize: 12, color: "#1a1a1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {d.name}</div>
                ))}
              </div>
            </div>
          )}

          {/* Provider */}
          <div>
            <label style={labelStyle}>Provider</label>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={providerId} onChange={(e) => selectProvider(e.target.value)}>
              {orderedProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {relevantIds.has(p.id) ? "  ★ suggested" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Recipient */}
          <div>
            <label style={labelStyle}>Recipient email</label>
            <input
              style={inputStyle}
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setRecipientTouched(true); }}
              placeholder="recipient@firm.com"
            />
          </div>

          {/* Message */}
          <div>
            <label style={labelStyle}>Message (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A short note to include in the email" />
          </div>

          {/* Preview */}
          <StagedActionsList actions={[pendingAction]} checkedIds={new Set([pendingAction.id])} onToggle={() => {}} disabled heading="Will be sent on confirm" />
          <div style={{ fontSize: 11, color: "#9494a0" }}>
            Delivered as one secure, expiring link — never a plain email attachment.
          </div>

          {result?.status === "failed" && (
            <div style={{ padding: "8px 12px", background: "#fbe8e8", border: "1px solid #f4b8b8", borderRadius: 6, color: "#7a1818", fontSize: 12 }}>
              {result.error || "Send failed"}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            {canSend && (
              <Button variant="primary" onClick={handleSend} disabled={sending || !providerId || !recipient.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
