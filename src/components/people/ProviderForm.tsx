"use client";

/**
 * ProviderForm — create/edit a Service Provider. Extracted from the old
 * /service-providers page so the People registry (Phase 6b) owns this CRUD.
 * POST /api/service-providers (create) · PUT /api/service-providers/[id] (edit),
 * then syncs entity links via /api/service-providers/[id]/entities. Renders the
 * full field set: disciplines, email domains, contacts, default recipient,
 * serves-all toggle, entity links, notes.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import type { ProviderContact } from "@/lib/types/entities";

export const DISCIPLINE_OPTIONS = ["tax", "bookkeeping", "legal", "valuation", "wealth_mgmt", "registered_agent", "trustee"];
export const DISCIPLINE_LABELS: Record<string, string> = {
  tax: "Tax", bookkeeping: "Bookkeeping", legal: "Legal", valuation: "Valuation",
  wealth_mgmt: "Wealth Mgmt", registered_agent: "Registered Agent", trustee: "Trustee",
};
export const disciplineLabel = (d: string) => DISCIPLINE_LABELS[d] ?? d;

export interface ProviderForEdit {
  id: string;
  name: string;
  disciplines: string[];
  domains: string[];
  contacts: ProviderContact[];
  default_contact_email: string | null;
  serves_all_entities: boolean;
  notes: string | null;
  entity_ids: string[];
}
export interface EntityOption { id: string; name: string; short_name: string | null }

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", fontSize: 13.5, fontFamily: "inherit",
  padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)",
  background: "var(--card)", color: "var(--ink)", outline: "none",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "5px 11px", borderRadius: 999, border: `1px solid ${active ? "var(--green)" : "var(--line)"}`,
  background: active ? "var(--green)" : "var(--card)", color: active ? "#fff" : "var(--muted)",
  fontSize: 12, fontFamily: "inherit", cursor: "pointer",
});

export function ProviderForm({ provider, entities, onSaved, onCancel }: {
  provider: ProviderForEdit | null;
  entities: EntityOption[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [disciplines, setDisciplines] = useState<string[]>(provider?.disciplines ?? []);
  const [domains, setDomains] = useState<string[]>(provider?.domains ?? []);
  const [domainDraft, setDomainDraft] = useState("");
  const [contacts, setContacts] = useState<ProviderContact[]>(provider?.contacts ?? []);
  const [defaultEmail, setDefaultEmail] = useState(provider?.default_contact_email ?? "");
  const [servesAll, setServesAll] = useState(!!provider?.serves_all_entities);
  const [entityIds, setEntityIds] = useState<string[]>(provider?.entity_ids ?? []);
  const [notes, setNotes] = useState(provider?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  const commitDomain = () => {
    const raw = domainDraft.trim().toLowerCase().replace(/^@+/, "");
    if (raw && !domains.includes(raw)) setDomains((d) => [...d, raw]);
    setDomainDraft("");
  };
  const updateContact = (i: number, patch: Partial<ProviderContact>) =>
    setContacts((cs) => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c));

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        disciplines,
        domains,
        contacts: contacts.filter((c) => c.name.trim() && c.email.trim()),
        default_contact_email: defaultEmail.trim() || null,
        serves_all_entities: servesAll,
        notes: notes.trim() || null,
      };
      let providerId = provider?.id ?? null;
      const priorEntityIds = provider?.entity_ids ?? [];

      const res = await fetch(provider ? `/api/service-providers/${provider.id}` : "/api/service-providers", {
        method: provider ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Couldn't save."); return; }
      if (!provider) providerId = (await res.json()).id;

      if (providerId) {
        const target = servesAll ? [] : entityIds;
        const toLink = target.filter((id) => !priorEntityIds.includes(id));
        const toUnlink = priorEntityIds.filter((id) => !target.includes(id));
        await Promise.all([
          ...toLink.map((entity_id) => fetch(`/api/service-providers/${providerId}/entities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id }) })),
          ...toUnlink.map((entity_id) => fetch(`/api/service-providers/${providerId}/entities`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id }) })),
        ]);
      }
      onSaved();
    } catch { setError("Couldn't save."); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ maxWidth: 420 }}>
        <label style={label}>Name</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Andersen" autoFocus />
      </div>

      <div>
        <label style={label}>Disciplines</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DISCIPLINE_OPTIONS.map((d) => (
            <button key={d} type="button" style={chip(disciplines.includes(d))} onClick={() => setDisciplines((x) => toggle(x, d))}>{disciplineLabel(d)}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 420 }}>
        <label style={label}>Email domains</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {domains.map((d) => (
            <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: "var(--hover)", fontSize: 12, color: "var(--ink)" }}>
              {d}
              <button type="button" onClick={() => setDomains((x) => x.filter((y) => y !== d))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><Icon name="x" size={11} /></button>
            </span>
          ))}
        </div>
        <input
          style={input} value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitDomain(); } }}
          onBlur={commitDomain} placeholder="andersen.com — Enter to add"
        />
      </div>

      <div>
        <label style={label}>Contacts</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {contacts.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input style={{ ...input, flex: "1 1 140px" }} value={c.name} onChange={(e) => updateContact(i, { name: e.target.value })} placeholder="Name" />
              <input style={{ ...input, flex: "1 1 180px" }} value={c.email} onChange={(e) => updateContact(i, { email: e.target.value })} placeholder="Email" />
              <input style={{ ...input, flex: "0 1 120px" }} value={c.role ?? ""} onChange={(e) => updateContact(i, { role: e.target.value })} placeholder="Role" />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                <input type="radio" name="default-contact" checked={!!c.is_default} onChange={() => setContacts((cs) => cs.map((x, idx) => ({ ...x, is_default: idx === i })))} /> Default
              </label>
              <button type="button" onClick={() => setContacts((cs) => cs.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setContacts((cs) => [...cs, { name: "", email: "", role: "", is_default: cs.length === 0 }])} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "var(--green)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
          <Icon name="plus" size={12} /> Add contact
        </button>
      </div>

      <div style={{ maxWidth: 420 }}>
        <label style={label}>Default recipient email (optional)</label>
        <input style={input} value={defaultEmail} onChange={(e) => setDefaultEmail(e.target.value)} placeholder="Falls back to the default contact above" />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)", cursor: "pointer" }}>
        <input type="checkbox" checked={servesAll} onChange={(e) => setServesAll(e.target.checked)} />
        Serves all entities (e.g. a firm like Andersen that touches everything)
      </label>

      {!servesAll && (
        <div>
          <label style={label}>Entities served</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 180, overflowY: "auto" }}>
            {entities.length === 0 && <span style={{ fontSize: 12, color: "var(--faint)" }}>No entities yet.</span>}
            {entities.map((e) => (
              <button key={e.id} type="button" style={chip(entityIds.includes(e.id))} onClick={() => setEntityIds((x) => toggle(x, e.id))}>{e.short_name || e.name}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 600 }}>
        <label style={label}>Notes (optional)</label>
        <textarea style={{ ...input, minHeight: 60, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : provider ? "Save changes" : "Add provider"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
