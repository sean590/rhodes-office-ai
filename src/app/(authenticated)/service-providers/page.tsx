"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SearchInput } from "@/components/ui/search-input";
import { FilterPills } from "@/components/ui/filter-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import type { ProviderContact } from "@/lib/types/entities";

// Suggested discipline set — free-form in the DB, but these drive the chips.
const DISCIPLINE_OPTIONS = [
  "tax",
  "bookkeeping",
  "legal",
  "valuation",
  "wealth_mgmt",
  "registered_agent",
  "trustee",
];

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

interface ProviderResponse {
  id: string;
  name: string;
  disciplines: string[];
  domains: string[];
  contacts: ProviderContact[];
  default_contact_email: string | null;
  serves_all_entities: boolean;
  notes: string | null;
  entity_ids: string[];
  entity_count: number;
}

interface EntityOption {
  id: string;
  name: string;
  short_name: string | null;
}

interface FormState {
  name: string;
  disciplines: string[];
  domains: string[];
  contacts: ProviderContact[];
  default_contact_email: string;
  serves_all_entities: boolean;
  entity_ids: string[];
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  disciplines: [],
  domains: [],
  contacts: [],
  default_contact_email: "",
  serves_all_entities: false,
  entity_ids: [],
  notes: "",
};

export default function ServiceProvidersPage() {
  const isMobile = useIsMobile();
  const setPageContext = useSetPageContext();

  const [providers, setProviders] = useState<ProviderResponse[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // One form drives both add and edit (centralized edit form, not inline).
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [domainDraft, setDomainDraft] = useState("");

  useEffect(() => {
    setPageContext({ page: "service_providers" });
  }, [setPageContext]);

  const fetchAll = useCallback(async () => {
    try {
      const [provRes, entRes] = await Promise.all([
        fetch("/api/service-providers"),
        fetch("/api/entities"),
      ]);
      if (provRes.ok) setProviders(await provRes.json());
      if (entRes.ok) {
        const entData = await entRes.json();
        setEntities(
          Array.isArray(entData)
            ? entData.map((e: EntityOption) => ({ id: e.id, name: e.name, short_name: e.short_name }))
            : [],
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // -----------------------------------------------------------------------
  // Form open/close
  // -----------------------------------------------------------------------

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDomainDraft("");
    setFormOpen(true);
  };

  const openEdit = (p: ProviderResponse) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      disciplines: p.disciplines ?? [],
      domains: p.domains ?? [],
      contacts: p.contacts ?? [],
      default_contact_email: p.default_contact_email ?? "",
      serves_all_entities: p.serves_all_entities,
      entity_ids: p.entity_ids ?? [],
      notes: p.notes ?? "",
    });
    setDomainDraft("");
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDomainDraft("");
  };

  // -----------------------------------------------------------------------
  // Form field helpers
  // -----------------------------------------------------------------------

  const toggleDiscipline = (d: string) =>
    setForm((f) => ({
      ...f,
      disciplines: f.disciplines.includes(d)
        ? f.disciplines.filter((x) => x !== d)
        : [...f.disciplines, d],
    }));

  const commitDomain = () => {
    const raw = domainDraft.trim().toLowerCase().replace(/^@+/, "");
    if (raw && !form.domains.includes(raw)) {
      setForm((f) => ({ ...f, domains: [...f.domains, raw] }));
    }
    setDomainDraft("");
  };

  const removeDomain = (d: string) =>
    setForm((f) => ({ ...f, domains: f.domains.filter((x) => x !== d) }));

  const addContact = () =>
    setForm((f) => ({
      ...f,
      contacts: [...f.contacts, { name: "", email: "", role: "", is_default: f.contacts.length === 0 }],
    }));

  const updateContact = (i: number, patch: Partial<ProviderContact>) =>
    setForm((f) => ({
      ...f,
      contacts: f.contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  const removeContact = (i: number) =>
    setForm((f) => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) }));

  const setDefaultContact = (i: number) =>
    setForm((f) => ({
      ...f,
      contacts: f.contacts.map((c, idx) => ({ ...c, is_default: idx === i })),
    }));

  const toggleEntity = (id: string) =>
    setForm((f) => ({
      ...f,
      entity_ids: f.entity_ids.includes(id)
        ? f.entity_ids.filter((x) => x !== id)
        : [...f.entity_ids, id],
    }));

  // -----------------------------------------------------------------------
  // Save (create or update) + sync entity links
  // -----------------------------------------------------------------------

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        disciplines: form.disciplines,
        domains: form.domains,
        contacts: form.contacts.filter((c) => c.name.trim() && c.email.trim()),
        default_contact_email: form.default_contact_email.trim() || null,
        serves_all_entities: form.serves_all_entities,
        notes: form.notes.trim() || null,
      };

      let providerId = editingId;
      let priorEntityIds: string[] = [];

      if (editingId) {
        const res = await fetch(`/api/service-providers/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to update provider");
        priorEntityIds = providers.find((p) => p.id === editingId)?.entity_ids ?? [];
      } else {
        const res = await fetch("/api/service-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create provider");
        const created = await res.json();
        providerId = created.id;
      }

      if (providerId) {
        // Sync entity links: link new ones, unlink removed ones.
        const target = form.serves_all_entities ? [] : form.entity_ids;
        const toLink = target.filter((id) => !priorEntityIds.includes(id));
        const toUnlink = priorEntityIds.filter((id) => !target.includes(id));
        await Promise.all([
          ...toLink.map((entity_id) =>
            fetch(`/api/service-providers/${providerId}/entities`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entity_id }),
            }),
          ),
          ...toUnlink.map((entity_id) =>
            fetch(`/api/service-providers/${providerId}/entities`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entity_id }),
            }),
          ),
        ]);
      }

      closeForm();
      await fetchAll();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const disciplineCounts: Record<string, number> = {};
  for (const p of providers) {
    for (const d of p.disciplines ?? []) {
      disciplineCounts[d] = (disciplineCounts[d] ?? 0) + 1;
    }
  }

  const filtered = providers.filter((p) => {
    if (filter !== "all" && !(p.disciplines ?? []).includes(filter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.domains ?? []).some((d) => d.toLowerCase().includes(q)) ||
        (p.disciplines ?? []).some((d) => disciplineLabel(d).toLowerCase().includes(q)) ||
        (p.default_contact_email ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const FILTER_OPTIONS = [
    { value: "all", label: "All" },
    ...DISCIPLINE_OPTIONS.filter((d) => disciplineCounts[d]).map((d) => ({
      value: d,
      label: disciplineLabel(d),
    })),
  ];

  // -----------------------------------------------------------------------
  // Shared styles
  // -----------------------------------------------------------------------

  const inputStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
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
    padding: "14px 12px",
    borderBottom: "1px solid #f0eee8",
    fontSize: 13,
    verticalAlign: "middle",
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "5px 11px",
    borderRadius: 999,
    border: `1px solid ${active ? "#2d5a3d" : "#ddd9d0"}`,
    background: active ? "#2d5a3d" : "#ffffff",
    color: active ? "#ffffff" : "#6b6b76",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
  });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f" }}>Service Providers</div>
        <div style={{ color: "#9494a0", marginTop: 12 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: isMobile ? 12 : 0, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f", margin: 0 }}>Service Providers</h1>
          <p style={{ fontSize: 13, color: "#6b6b76", margin: "4px 0 0" }}>
            The firms Rhodes routes documents to &mdash; recognized by email domain, linked to the entities they serve
          </p>
        </div>
        {!formOpen && (
          <Button variant="primary" onClick={openAdd}>
            <PlusIcon size={14} /> Add Provider
          </Button>
        )}
      </div>

      {/* Add / edit form */}
      {formOpen && (
        <Card style={{ marginBottom: 20 }}>
          <SectionHeader>{editingId ? "Edit Provider" : "Add Provider"}</SectionHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Name */}
            <div style={{ maxWidth: 420 }}>
              <label style={labelStyle}>Name</label>
              <input
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Andersen"
              />
            </div>

            {/* Disciplines */}
            <div>
              <label style={labelStyle}>Disciplines</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {DISCIPLINE_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    style={chip(form.disciplines.includes(d))}
                    onClick={() => toggleDiscipline(d)}
                  >
                    {disciplineLabel(d)}
                  </button>
                ))}
              </div>
            </div>

            {/* Domains */}
            <div style={{ maxWidth: 420 }}>
              <label style={labelStyle}>Email Domains</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {form.domains.map((d) => (
                  <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: "#f0eee8", fontSize: 12, color: "#1a1a1f" }}>
                    {d}
                    <button type="button" onClick={() => removeDomain(d)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", fontFamily: "inherit" }}>
                      <XIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <input
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    commitDomain();
                  }
                }}
                onBlur={commitDomain}
                placeholder="andersen.com — Enter to add"
              />
            </div>

            {/* Contacts */}
            <div>
              <label style={labelStyle}>Contacts</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {form.contacts.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      style={{ ...inputStyle, flex: "1 1 140px" }}
                      value={c.name}
                      onChange={(e) => updateContact(i, { name: e.target.value })}
                      placeholder="Name"
                    />
                    <input
                      style={{ ...inputStyle, flex: "1 1 180px" }}
                      value={c.email}
                      onChange={(e) => updateContact(i, { email: e.target.value })}
                      placeholder="Email"
                    />
                    <input
                      style={{ ...inputStyle, flex: "0 1 120px" }}
                      value={c.role ?? ""}
                      onChange={(e) => updateContact(i, { role: e.target.value })}
                      placeholder="Role"
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6b6b76", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="default-contact"
                        checked={!!c.is_default}
                        onChange={() => setDefaultContact(i)}
                      />
                      Default
                    </label>
                    <button type="button" onClick={() => removeContact(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", fontFamily: "inherit" }}>
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <Button onClick={addContact} style={{ marginTop: 8 }}>
                <PlusIcon size={12} /> Add Contact
              </Button>
            </div>

            {/* Default recipient (fallback if no default contact) */}
            <div style={{ maxWidth: 420 }}>
              <label style={labelStyle}>Default Recipient Email (optional)</label>
              <input
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                value={form.default_contact_email}
                onChange={(e) => setForm((f) => ({ ...f, default_contact_email: e.target.value }))}
                placeholder="Falls back to the default contact above"
              />
            </div>

            {/* Serves all entities */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1a1a1f", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.serves_all_entities}
                onChange={(e) => setForm((f) => ({ ...f, serves_all_entities: e.target.checked }))}
              />
              Serves all entities (e.g. a firm like Andersen that touches everything)
            </label>

            {/* Entity links */}
            {!form.serves_all_entities && (
              <div>
                <label style={labelStyle}>Entities Served</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {entities.length === 0 && <span style={{ fontSize: 12, color: "#9494a0" }}>No entities yet.</span>}
                  {entities.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      style={chip(form.entity_ids.includes(e.id))}
                      onClick={() => toggleEntity(e.id)}
                    >
                      {e.short_name || e.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div style={{ maxWidth: 600 }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", minHeight: 60, resize: "vertical" }}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : editingId ? "Save Changes" : "Save"}
              </Button>
              <Button onClick={closeForm}>
                <XIcon size={12} /> Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Filter + search */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 0, marginBottom: 16 }}>
        <div style={isMobile ? { overflowX: "auto", flexWrap: "nowrap", WebkitOverflowScrolling: "touch" } : undefined}>
          <FilterPills
            options={FILTER_OPTIONS.map((o) => ({
              ...o,
              count: o.value === "all" ? providers.length : disciplineCounts[o.value] ?? 0,
            }))}
            selected={filter}
            onChange={setFilter}
          />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search providers..." />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <Card>
          <div style={{ textAlign: "center", padding: "32px 0", color: "#9494a0", fontSize: 14 }}>
            {providers.length === 0 ? "No service providers yet. Add your first firm." : "No providers match your filter."}
          </div>
        </Card>
      )}

      {/* Desktop table */}
      {filtered.length > 0 && !isMobile && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Disciplines</th>
                <th style={thStyle}>Domains</th>
                <th style={thStyle}>Default Recipient</th>
                <th style={thStyle}>Entities</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    <Link href={`/service-providers/${p.id}`} style={{ color: "#2d5a3d", textDecoration: "none" }}>{p.name}</Link>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(p.disciplines ?? []).map((d) => (
                        <Badge key={d} label={disciplineLabel(d)} color="#2d5a3d" bg="#eef3ef" />
                      ))}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "#6b6b76" }}>{(p.domains ?? []).join(", ") || "—"}</td>
                  <td style={{ ...tdStyle, color: "#6b6b76" }}>
                    {p.default_contact_email || p.contacts?.find((c) => c.is_default)?.email || "—"}
                  </td>
                  <td style={{ ...tdStyle, color: "#6b6b76" }}>
                    {p.serves_all_entities ? "All entities" : p.entity_count > 0 ? `${p.entity_count}` : "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button onClick={() => openEdit(p)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Mobile cards */}
      {filtered.length > 0 && isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((p) => (
            <Card key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <Link href={`/service-providers/${p.id}`} style={{ fontWeight: 600, fontSize: 15, color: "#2d5a3d", textDecoration: "none" }}>{p.name}</Link>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button onClick={() => openEdit(p)}>Edit</Button>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {(p.disciplines ?? []).map((d) => (
                  <Badge key={d} label={disciplineLabel(d)} color="#2d5a3d" bg="#eef3ef" />
                ))}
              </div>
              {(p.domains ?? []).length > 0 && (
                <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 8 }}>{(p.domains ?? []).join(", ")}</div>
              )}
              <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 6 }}>
                {p.serves_all_entities ? "Serves all entities" : `${p.entity_count} ${p.entity_count === 1 ? "entity" : "entities"}`}
                {(p.default_contact_email || p.contacts?.find((c) => c.is_default)?.email) &&
                  ` · ${p.default_contact_email || p.contacts?.find((c) => c.is_default)?.email}`}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
