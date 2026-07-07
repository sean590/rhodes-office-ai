"use client";

/**
 * People — the unified registry (Phase 6b). One browsable list merging the
 * Directory (individuals / companies / trusts) and Service Providers (firms),
 * and the single place to add / edit / delete them. Directory CRUD runs inline
 * here (DirectoryEntryForm); provider CRUD runs inline here too (ProviderForm),
 * with the rich per-provider record (sends / routing) still on the provider
 * detail page, reached via "Open full record". The old /directory and
 * /service-providers list routes redirect here.
 *
 * Your own entities never appear here — People is external + role-holders only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCan } from "@/components/authz/role-provider";
import { SearchInput } from "@/components/ui/search-input";
import { FilterPills } from "@/components/ui/filter-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DirectoryEntryForm, type DirectoryEntryType } from "@/components/people/DirectoryEntryForm";
import { ProviderForm, type EntityOption, disciplineLabel } from "@/components/people/ProviderForm";
import type { ProviderContact } from "@/lib/types/entities";

type Kind = "person" | "company" | "trust" | "provider";

interface PersonRow {
  id: string;             // "directory:uuid" | "provider:uuid"
  rawId: string;          // bare uuid
  source: "directory" | "provider";
  name: string;
  kind: Kind;
  email: string | null;
  aliases: string[];
  usageDetails: string | null;
  directoryType: DirectoryEntryType;    // directory
  disciplines: string[];                // provider
  domains: string[];                    // provider
  contacts: ProviderContact[];          // provider
  defaultContactEmail: string | null;   // provider
  servesAllEntities: boolean;           // provider
  entityCount: number;                  // provider
  entityIds: string[];                  // provider
  notes: string | null;                 // provider
  recordHref: string | null;            // provider → full record
  searchText: string;
}

const KIND_META: Record<Kind, { label: string; color: string; bg: string }> = {
  person: { label: "Person", color: "var(--green)", bg: "var(--green-50)" },
  company: { label: "Company", color: "var(--blue)", bg: "var(--blue-50)" },
  trust: { label: "Trust", color: "var(--purple)", bg: "var(--purple-50)" },
  provider: { label: "Provider", color: "var(--amber)", bg: "var(--amber-50)" },
};

const FILTERS: { value: string; label: string; match: (k: Kind) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "person", label: "People", match: (k) => k === "person" },
  { value: "company", label: "Companies", match: (k) => k === "company" },
  { value: "trust", label: "Trusts", match: (k) => k === "trust" },
  { value: "provider", label: "Providers", match: (k) => k === "provider" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface DirectoryApi { id: string; name: string; type: DirectoryEntryType; email: string | null; aliases: string[]; usage_count: number; usage_details: string }
interface ProviderApi { id: string; name: string; disciplines: string[]; domains: string[]; contacts: ProviderContact[]; default_contact_email: string | null; serves_all_entities: boolean; notes: string | null; entity_ids: string[]; entity_count: number }

function dirKind(type: string): Kind {
  if (type === "external_entity") return "company";
  if (type === "trust") return "trust";
  return "person";
}

type FormState =
  | { mode: "add-person" }
  | { mode: "add-provider" }
  | { mode: "edit"; row: PersonRow }
  | null;

export default function PeoplePage() {
  const isMobile = useIsMobile();
  const canDelete = useCan("records:delete");
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [replace, setReplace] = useState<{ row: PersonRow; usageCount: number } | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, pRes, eRes] = await Promise.all([
        fetch("/api/directory"),
        fetch("/api/service-providers"),
        fetch("/api/entities"),
      ]);
      const dir: DirectoryApi[] = dRes.ok ? await dRes.json() : [];
      const prov: ProviderApi[] = pRes.ok ? await pRes.json() : [];
      const ents = eRes.ok ? await eRes.json() : [];
      setEntities(Array.isArray(ents) ? ents.map((e: EntityOption) => ({ id: e.id, name: e.name, short_name: e.short_name })) : []);

      const dirRows: PersonRow[] = (Array.isArray(dir) ? dir : []).map((d) => ({
        id: `directory:${d.id}`, rawId: d.id, source: "directory", name: d.name, kind: dirKind(d.type),
        email: d.email, aliases: d.aliases ?? [], usageDetails: d.usage_count > 0 ? d.usage_details : null,
        directoryType: d.type, disciplines: [], domains: [], contacts: [], defaultContactEmail: null,
        servesAllEntities: false, entityCount: 0, entityIds: [], notes: null, recordHref: null,
        searchText: [d.name, d.email, ...(d.aliases ?? [])].filter(Boolean).join(" ").toLowerCase(),
      }));
      const provRows: PersonRow[] = (Array.isArray(prov) ? prov : []).map((p) => {
        // Resolve the default recipient the way the full record does: explicit
        // override first, else the contact flagged Default. So the People panel
        // and the provider record agree at a glance.
        const resolvedDefault = p.default_contact_email || (p.contacts ?? []).find((c) => c.is_default)?.email || null;
        return ({
        id: `provider:${p.id}`, rawId: p.id, source: "provider", name: p.name, kind: "provider",
        email: resolvedDefault, aliases: [], usageDetails: null, directoryType: "individual",
        disciplines: p.disciplines ?? [], domains: p.domains ?? [], contacts: p.contacts ?? [],
        defaultContactEmail: resolvedDefault, servesAllEntities: !!p.serves_all_entities,
        entityCount: p.entity_count ?? 0, entityIds: p.entity_ids ?? [], notes: p.notes ?? null,
        recordHref: `/people/${p.id}?type=provider`,
        searchText: [p.name, resolvedDefault, ...(p.disciplines ?? []), ...(p.domains ?? [])].filter(Boolean).join(" ").toLowerCase(),
        });
      });
      setRows([...dirRows, ...provRows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
    } catch (err) {
      console.error("Failed to load people:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onSaved = useCallback(() => { setForm(null); fetchAll(); }, [fetchAll]);

  const deleteRow = useCallback(async (row: PersonRow) => {
    setBusyId(row.id);
    try {
      const url = row.source === "directory" ? `/api/directory/${row.rawId}` : `/api/service-providers/${row.rawId}`;
      const res = await fetch(url, { method: "DELETE" });
      if (row.source === "directory" && res.status === 409) {
        const d = await res.json().catch(() => ({}));
        setReplace({ row, usageCount: d.usage_count || 0 });
        setReplacementId("");
        return;
      }
      if (!res.ok) { alert("Couldn't delete."); return; }
      await fetchAll();
    } finally { setBusyId(null); }
  }, [fetchAll]);

  const confirmReplace = useCallback(async () => {
    if (!replace || !replacementId) return;
    setBusyId(replace.row.id);
    try {
      const res = await fetch(`/api/directory/${replace.row.rawId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacement_id: replacementId }),
      });
      if (!res.ok) { alert("Couldn't replace and delete."); return; }
      setReplace(null); setReplacementId("");
      await fetchAll();
    } finally { setBusyId(null); }
  }, [replace, replacementId, fetchAll]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, person: 0, company: 0, trust: 0, provider: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    return rows.filter((r) => f.match(r.kind) && (!q || r.searchText.includes(q)));
  }, [rows, query, filter]);

  // Replacement candidates: other directory entries of the same kind.
  const replaceCandidates = useMemo(
    () => replace ? rows.filter((r) => r.source === "directory" && r.id !== replace.row.id) : [],
    [rows, replace],
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.02em" }}>People</h1>
        {!form && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setExpanded(null); setForm({ mode: "add-person" }); }} style={addBtn}><Icon name="plus" size={14} /> Add person</button>
            <button onClick={() => { setExpanded(null); setForm({ mode: "add-provider" }); }} style={addBtn}><Icon name="plus" size={14} /> Add provider</button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 16px" }}>
        Everyone Rhodes works with — contacts, counterparties, and service providers — in one place.
      </p>

      {/* Add / edit form panel */}
      {form && (
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 14 }}>
            {form.mode === "add-person" ? "Add person" : form.mode === "add-provider" ? "Add provider" : form.row.source === "provider" ? "Edit provider" : "Edit person"}
          </div>
          {form.mode === "add-provider" || (form.mode === "edit" && form.row.source === "provider") ? (
            <ProviderForm
              entities={entities}
              provider={form.mode === "edit" ? {
                id: form.row.rawId, name: form.row.name, disciplines: form.row.disciplines, domains: form.row.domains,
                contacts: form.row.contacts, default_contact_email: form.row.defaultContactEmail,
                serves_all_entities: form.row.servesAllEntities, notes: form.row.notes, entity_ids: form.row.entityIds,
              } : null}
              onSaved={onSaved} onCancel={() => setForm(null)}
            />
          ) : (
            <DirectoryEntryForm
              entry={form.mode === "edit" ? {
                id: form.row.rawId, name: form.row.name, type: form.row.directoryType, email: form.row.email, aliases: form.row.aliases,
              } : null}
              onSaved={onSaved} onCancel={() => setForm(null)}
            />
          )}
        </div>
      )}

      {!form && (
        <>
          <div style={{ marginBottom: 12 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search people, providers, emails…" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <FilterPills selected={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
          </div>

          {loading ? (
            <div style={{ padding: 60, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--muted)" }}>
              <Icon name="users" size={26} color="var(--faint)" />
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginTop: 10 }}>No people found</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{rows.length === 0 ? "Add a person or provider to get started." : "Try a different search or filter."}</div>
            </div>
          ) : (
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", overflow: "hidden" }}>
              {visible.map((r, i) => (
                <PersonRowView
                  key={r.id} row={r} isMobile={isMobile} first={i === 0} busy={busyId === r.id}
                  open={expanded === r.id} canDelete={canDelete}
                  onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                  onEdit={() => { setExpanded(null); setForm({ mode: "edit", row: r }); }}
                  onDelete={() => deleteRow(r)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Replace & delete modal (directory entries referenced elsewhere) */}
      {replace && (
        <>
          <div onClick={() => setReplace(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,24,20,0.28)", zIndex: 60 }} />
          <div role="dialog" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 61, width: "min(460px, 92vw)", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "0 20px 60px rgba(20,24,20,0.2)", padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon name="alert-triangle" size={18} color="var(--amber)" />
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>This contact is in use</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--ink)" }}>{replace.row.name}</strong> is referenced in {replace.usageCount} place{replace.usageCount === 1 ? "" : "s"}. Pick who should replace it everywhere, then delete.
            </p>
            <select value={replacementId} onChange={(e) => setReplacementId(e.target.value)} style={{ width: "100%", boxSizing: "border-box", fontSize: 13.5, padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--card)", color: "var(--ink)", marginBottom: 16 }}>
              <option value="">Select a replacement…</option>
              {replaceCandidates.map((c) => <option key={c.id} value={c.rawId}>{c.name}</option>)}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="secondary" onClick={() => setReplace(null)}>Cancel</Button>
              <Button variant="primary" onClick={confirmReplace} disabled={!replacementId || busyId === replace.row.id}>Replace &amp; delete</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const addBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600,
  color: "var(--ink)", padding: "6px 12px", border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)", background: "var(--card)", cursor: "pointer", fontFamily: "inherit",
};

function PersonRowView({ row, open, onToggle, onEdit, onDelete, first, isMobile, busy, canDelete }: {
  row: PersonRow; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void; first: boolean; isMobile: boolean; busy: boolean; canDelete: boolean;
}) {
  const meta = KIND_META[row.kind];
  const secondary = row.source === "provider"
    ? (row.disciplines.length ? row.disciplines.map(disciplineLabel).join(" · ") : "Service provider")
    : (row.email || (row.usageDetails ? `Appears in ${row.usageDetails}` : "No email on file"));

  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--line)", opacity: busy ? 0.6 : 1 }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: open ? "var(--hover)" : "var(--card)", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
        <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 999, background: meta.bg, color: meta.color, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>{initials(row.name)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
            <Badge label={meta.label} color={meta.color} bg={meta.bg} />
          </span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{secondary}</span>
        </span>
        {!isMobile && row.source === "provider" && (row.servesAllEntities || row.entityCount > 0) && (
          <span style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>{row.servesAllEntities ? "All entities" : `${row.entityCount} ${row.entityCount === 1 ? "entity" : "entities"}`}</span>
        )}
        <Icon name="chevron-down" size={16} style={{ flexShrink: 0, color: "var(--faint)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div style={{ padding: "4px 16px 16px 60px", background: "var(--card)" }}>
          {row.source === "directory" ? (
            <Detail>
              <Field label="Email" value={row.email || "—"} />
              {row.aliases.length > 0 && <Field label="Also known as" value={row.aliases.join(", ")} />}
              <Field label="Appears in" value={row.usageDetails || "Not referenced yet"} />
              <RowActions>
                <Link href={`/people/${row.rawId}?type=directory`} style={{ ...actionBtn, textDecoration: "none" }}><Icon name="external-link" size={14} /> Open full record</Link>
                <button onClick={onEdit} style={actionBtn}><Icon name="pencil" size={14} /> Edit</button>
                {canDelete && <button onClick={onDelete} style={{ ...actionBtn, color: "var(--red)" }}><Icon name="trash" size={14} /> Delete</button>}
              </RowActions>
            </Detail>
          ) : (
            <Detail>
              {row.disciplines.length > 0 && (
                <Field label="Disciplines" value={<span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{row.disciplines.map((d) => <Badge key={d} label={disciplineLabel(d)} color="var(--teal)" bg="var(--teal-50)" />)}</span>} />
              )}
              <Field label="Default contact" value={row.defaultContactEmail || "—"} />
              {row.domains.length > 0 && <Field label="Email domains" value={row.domains.join(", ")} />}
              {row.contacts.length > 0 && (
                <Field label="Contacts" value={
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {row.contacts.map((c, i) => (
                      <span key={i} style={{ fontSize: 13, color: "var(--ink)" }}>{c.name || c.email}{c.role ? <span style={{ color: "var(--muted)" }}> · {c.role}</span> : null}{c.name && c.email ? <span style={{ color: "var(--muted)" }}> · {c.email}</span> : null}</span>
                    ))}
                  </span>
                } />
              )}
              <Field label="Serves" value={row.servesAllEntities ? "All entities" : `${row.entityCount} ${row.entityCount === 1 ? "entity" : "entities"}`} />
              <RowActions>
                <button onClick={onEdit} style={actionBtn}><Icon name="pencil" size={14} /> Edit</button>
                {row.recordHref && <Link href={row.recordHref} style={{ ...actionBtn, textDecoration: "none" }}><Icon name="external-link" size={14} /> Open full record</Link>}
                {canDelete && <button onClick={onDelete} style={{ ...actionBtn, color: "var(--red)" }}><Icon name="trash" size={14} /> Delete</button>}
              </RowActions>
            </Detail>
          )}
        </div>
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--green)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 };

function Detail({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>{children}</div>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ flexShrink: 0, width: 110, fontSize: 12, fontWeight: 600, color: "var(--muted)", paddingTop: 1 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" }}>{value}</span>
    </div>
  );
}
function RowActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 16, marginTop: 4 }}>{children}</div>;
}
