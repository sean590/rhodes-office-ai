"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_CATEGORY_OPTIONS,
  DOCUMENT_CATEGORY_LABELS,
} from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";
import {
  DOCUMENT_SCOPES,
  getSystemDefaultsForScope,
  type DocumentScope,
} from "@/lib/data/document-defaults";

interface Profile {
  id: string;
  entity_type_scope: string;
  document_type: string;
  document_category: string;
  enabled: boolean;
  is_required: boolean;
  notes: string | null;
}

interface OrgOverride {
  id: string;
  document_type: string;
  action: string;
  reason: string | null;
}

const SCOPE_LABELS: Record<string, string> = {
  llc: "LLC",
  corporation: "Corporation",
  lp: "LP",
  trust: "Trust",
};

function docTypeLabel(slug: string): string {
  return DOCUMENT_TYPE_LABELS[slug] || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ───────────────────────────────────────────────────────────────────
// Tier 1 — Org-wide document type overrides
// ───────────────────────────────────────────────────────────────────

export function DocumentRulesSection({ isMobile }: { isMobile: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overrides, setOverrides] = useState<OrgOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [profilesRes, overridesRes] = await Promise.all([
      fetch("/api/documents/profiles"),
      fetch("/api/documents/overrides"),
    ]);
    if (profilesRes.ok) setProfiles(await profilesRes.json());
    if (overridesRes.ok) setOverrides(await overridesRes.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [profilesRes, overridesRes] = await Promise.all([
        fetch("/api/documents/profiles"),
        fetch("/api/documents/overrides"),
      ]);
      if (cancelled) return;
      if (profilesRes.ok) setProfiles(await profilesRes.json());
      if (overridesRes.ok) setOverrides(await overridesRes.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Distinct document_types across all profiles, paired with a representative
  // category. If a doc_type appears in multiple scopes with different categories
  // (shouldn't happen post-migration but be defensive), the first one wins.
  const docTypes = new Map<string, string>();
  for (const p of profiles) {
    if (!docTypes.has(p.document_type)) docTypes.set(p.document_type, p.document_category);
  }

  const overrideMap = new Map(overrides.map((o) => [o.document_type, o]));
  const disabledCount = overrides.filter((o) => o.action === "disable").length;

  // Group by category, preserving the order of DOCUMENT_CATEGORY_OPTIONS
  const grouped = new Map<string, { document_type: string; category: string }[]>();
  for (const opt of DOCUMENT_CATEGORY_OPTIONS) grouped.set(opt.value, []);
  for (const [docType, category] of docTypes) {
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push({ document_type: docType, category });
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => docTypeLabel(a.document_type).localeCompare(docTypeLabel(b.document_type)));
  }

  const toggleOverride = async (docType: string, currentlyDisabled: boolean) => {
    setSaving(docType);
    if (currentlyDisabled) {
      await fetch(`/api/documents/overrides?document_type=${encodeURIComponent(docType)}`, { method: "DELETE" });
    } else {
      await fetch("/api/documents/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_type: docType, action: "disable" }),
      });
    }
    await refresh();
    setSaving(null);
  };

  if (loading) {
    return <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading document rules...</div>;
  }

  if (docTypes.size === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
        No document profiles yet. Initialize defaults below to populate document types.
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 16px 0" }}>
        Disable a document type org-wide to prevent it from being expected on any entity.
        {disabledCount > 0 && (
          <span style={{ marginLeft: 8, color: "#c47520", fontWeight: 500 }}>
            {disabledCount} disabled
          </span>
        )}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {[...grouped.entries()]
          .filter(([, list]) => list.length > 0)
          .map(([category, list]) => (
            <CategoryGroup
              key={category}
              category={category as DocumentCategory}
              docTypes={list}
              overrideMap={overrideMap}
              saving={saving}
              onToggle={toggleOverride}
              isMobile={isMobile}
            />
          ))}
      </div>
    </div>
  );
}

function CategoryGroup({
  category, docTypes, overrideMap, saving, onToggle, isMobile,
}: {
  category: DocumentCategory;
  docTypes: { document_type: string; category: string }[];
  overrideMap: Map<string, OrgOverride>;
  saving: string | null;
  onToggle: (docType: string, disabled: boolean) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const disabledInGroup = docTypes.filter((d) => overrideMap.get(d.document_type)?.action === "disable").length;

  return (
    <div style={{ border: "1px solid #e8e6df", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: open ? "#fafaf7" : "#fff",
          border: "none", cursor: "pointer", fontSize: 13, textAlign: "left",
        }}
      >
        <svg
          width={12} height={12} viewBox="0 0 24 24" fill="none"
          stroke="#9494a0" strokeWidth="2" strokeLinecap="round"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ fontWeight: 600, color: "#1a1a1f" }}>
          {DOCUMENT_CATEGORY_LABELS[category] || category}
        </span>
        <span style={{ color: "#9494a0", fontSize: 12 }}>
          {docTypes.length} type{docTypes.length !== 1 ? "s" : ""}
        </span>
        {disabledInGroup > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
            color: "#c47520", background: "rgba(196,117,32,0.08)", marginLeft: "auto",
          }}>
            {disabledInGroup} disabled
          </span>
        )}
      </button>
      {open && (
        <div style={{ borderTop: "1px solid #e8e6df" }}>
          {docTypes.map(({ document_type }) => {
            const override = overrideMap.get(document_type);
            const isDisabled = override?.action === "disable";
            const isSaving = saving === document_type;
            return (
              <div
                key={document_type}
                style={{
                  display: "flex", alignItems: isMobile ? "flex-start" : "center",
                  flexDirection: isMobile ? "column" : "row",
                  gap: isMobile ? 6 : 10,
                  padding: "10px 14px 10px 36px",
                  borderBottom: "1px solid #f0eee8",
                  opacity: isDisabled ? 0.5 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                    {docTypeLabel(document_type)}
                  </div>
                </div>
                <ToggleSwitch
                  checked={!isDisabled}
                  disabled={isSaving}
                  onChange={() => onToggle(document_type, isDisabled)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Tier 2 — Per-entity-type document profiles
// ───────────────────────────────────────────────────────────────────

export function DocumentProfilesSection({ isMobile }: { isMobile: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overrides, setOverrides] = useState<OrgOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const refresh = useCallback(async () => {
    const [profilesRes, overridesRes] = await Promise.all([
      fetch("/api/documents/profiles"),
      fetch("/api/documents/overrides"),
    ]);
    if (profilesRes.ok) setProfiles(await profilesRes.json());
    if (overridesRes.ok) setOverrides(await overridesRes.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [profilesRes, overridesRes] = await Promise.all([
        fetch("/api/documents/profiles"),
        fetch("/api/documents/overrides"),
      ]);
      if (cancelled) return;
      if (profilesRes.ok) setProfiles(await profilesRes.json());
      if (overridesRes.ok) setOverrides(await overridesRes.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const orgDisabledSet = new Set(
    overrides.filter((o) => o.action === "disable").map((o) => o.document_type)
  );

  const seedScope = async (scope: DocumentScope) => {
    setSeeding(scope);
    await fetch("/api/documents/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type_scope: scope }),
    });
    await refresh();
    setSeeding(null);
  };

  const toggleEnabled = async (profile: Profile) => {
    setSaving(profile.id);
    await fetch("/api/documents/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_type_scope: profile.entity_type_scope,
        document_type: profile.document_type,
        document_category: profile.document_category,
        enabled: !profile.enabled,
        is_required: profile.is_required,
        notes: profile.notes,
      }),
    });
    await refresh();
    setSaving(null);
  };

  const toggleRequired = async (profile: Profile) => {
    setSaving(profile.id);
    await fetch("/api/documents/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_type_scope: profile.entity_type_scope,
        document_type: profile.document_type,
        document_category: profile.document_category,
        enabled: profile.enabled,
        is_required: !profile.is_required,
        notes: profile.notes,
      }),
    });
    await refresh();
    setSaving(null);
  };

  const deleteProfile = async (profile: Profile) => {
    const isSystemDefault = getSystemDefaultsForScope(profile.entity_type_scope as DocumentScope)
      .some((d) => d.document_type === profile.document_type);
    const msg = isSystemDefault
      ? `Remove ${docTypeLabel(profile.document_type)} from ${SCOPE_LABELS[profile.entity_type_scope]}? You can re-seed defaults to restore it.`
      : `Remove ${docTypeLabel(profile.document_type)} from ${SCOPE_LABELS[profile.entity_type_scope]}?`;
    if (!confirm(msg)) return;
    setSaving(profile.id);
    await fetch(`/api/documents/profiles?id=${profile.id}`, { method: "DELETE" });
    await refresh();
    setSaving(null);
  };

  const addCustom = async (params: {
    document_type: string;
    document_category: string;
    is_required: boolean;
    scopes: DocumentScope[];
  }) => {
    for (const scope of params.scopes) {
      await fetch("/api/documents/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type_scope: scope,
          document_type: params.document_type,
          document_category: params.document_category,
          enabled: true,
          is_required: params.is_required,
        }),
      });
    }
    await refresh();
    setShowAddForm(false);
  };

  if (loading) {
    return <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading document profiles...</div>;
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 16px 0" }}>
        Control which documents apply to each entity type. Document types disabled org-wide (above) are shown grayed out.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {DOCUMENT_SCOPES.map((scope) => {
          const scopeProfiles = profiles
            .filter((p) => p.entity_type_scope === scope)
            .sort((a, b) => docTypeLabel(a.document_type).localeCompare(docTypeLabel(b.document_type)));

          return (
            <ScopeProfileGroup
              key={scope}
              scope={scope}
              profiles={scopeProfiles}
              orgDisabledSet={orgDisabledSet}
              seeding={seeding === scope}
              saving={saving}
              onSeed={() => seedScope(scope)}
              onToggleEnabled={toggleEnabled}
              onToggleRequired={toggleRequired}
              onDelete={deleteProfile}
              isMobile={isMobile}
            />
          );
        })}
      </div>

      <div style={{ marginTop: 16 }}>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
              background: "#fff", color: "#2d5a3d", border: "1px solid #2d5a3d",
              cursor: "pointer",
            }}
          >
            + Add custom document requirement
          </button>
        ) : (
          <AddCustomForm
            onCancel={() => setShowAddForm(false)}
            onSubmit={addCustom}
            isMobile={isMobile}
          />
        )}
      </div>
    </div>
  );
}

function ScopeProfileGroup({
  scope, profiles, orgDisabledSet, seeding, saving,
  onSeed, onToggleEnabled, onToggleRequired, onDelete, isMobile,
}: {
  scope: DocumentScope;
  profiles: Profile[];
  orgDisabledSet: Set<string>;
  seeding: boolean;
  saving: string | null;
  onSeed: () => void;
  onToggleEnabled: (profile: Profile) => void;
  onToggleRequired: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);

  const disabledCount = profiles.filter((p) => {
    if (orgDisabledSet.has(p.document_type)) return true;
    return !p.enabled;
  }).length;

  return (
    <div style={{ border: "1px solid #e8e6df", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: open ? "#fafaf7" : "#fff",
          border: "none", cursor: "pointer", fontSize: 13, textAlign: "left",
        }}
      >
        <svg
          width={12} height={12} viewBox="0 0 24 24" fill="none"
          stroke="#9494a0" strokeWidth="2" strokeLinecap="round"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ fontWeight: 600, color: "#1a1a1f" }}>
          {SCOPE_LABELS[scope]}
        </span>
        <span style={{ color: "#9494a0", fontSize: 12 }}>
          {profiles.length} requirement{profiles.length !== 1 ? "s" : ""}
        </span>
        {disabledCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
            color: "#c47520", background: "rgba(196,117,32,0.08)", marginLeft: "auto",
          }}>
            {disabledCount} disabled
          </span>
        )}
      </button>
      {open && (
        <div style={{ borderTop: "1px solid #e8e6df" }}>
          {profiles.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 12px 0" }}>
                No requirements configured for {SCOPE_LABELS[scope]} yet.
              </p>
              <button
                onClick={onSeed}
                disabled={seeding}
                style={{
                  padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                  background: "#2d5a3d", color: "#fff", border: "none",
                  cursor: seeding ? "default" : "pointer", opacity: seeding ? 0.6 : 1,
                }}
              >
                {seeding ? "Seeding..." : `Initialize ${SCOPE_LABELS[scope]} defaults`}
              </button>
            </div>
          ) : (
            <>
              {profiles.map((profile) => {
                const isOrgDisabled = orgDisabledSet.has(profile.document_type);
                const isEnabled = isOrgDisabled ? false : profile.enabled;
                const isSaving = saving === profile.id;

                return (
                  <div
                    key={profile.id}
                    style={{
                      display: "flex", alignItems: isMobile ? "flex-start" : "center",
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? 6 : 10,
                      padding: "10px 14px 10px 36px",
                      borderBottom: "1px solid #f0eee8",
                      opacity: isOrgDisabled ? 0.35 : isEnabled ? 1 : 0.5,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>
                        {docTypeLabel(profile.document_type)}
                        {isOrgDisabled && (
                          <span style={{
                            marginLeft: 8, fontSize: 10, color: "#c47520", fontWeight: 500,
                          }}>
                            disabled org-wide
                          </span>
                        )}
                      </div>
                      {profile.notes && (
                        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>
                          {profile.notes}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => onToggleRequired(profile)}
                        disabled={isSaving || isOrgDisabled || !isEnabled}
                        style={{
                          fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
                          cursor: (isSaving || isOrgDisabled || !isEnabled) ? "default" : "pointer",
                          border: "none",
                          color: profile.is_required ? "#c47520" : "#6b6b76",
                          background: profile.is_required ? "rgba(196,117,32,0.08)" : "rgba(107,107,118,0.08)",
                        }}
                        title="Click to toggle required/optional"
                      >
                        {profile.is_required ? "Required" : "Optional"}
                      </button>
                      <span style={{
                        fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                        color: "#9494a0", background: "rgba(107,107,118,0.05)",
                      }}>
                        {DOCUMENT_CATEGORY_LABELS[profile.document_category as DocumentCategory] || profile.document_category}
                      </span>
                      <ToggleSwitch
                        checked={isEnabled}
                        disabled={isSaving || isOrgDisabled}
                        onChange={() => onToggleEnabled(profile)}
                      />
                      <button
                        onClick={() => onDelete(profile)}
                        disabled={isSaving}
                        style={{
                          background: "none", border: "none",
                          color: "#c73e3e", cursor: "pointer",
                          fontSize: 11, padding: "4px 6px",
                          opacity: isSaving ? 0.5 : 1,
                        }}
                        title="Remove this requirement"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: "8px 14px 8px 36px" }}>
                <button
                  onClick={onSeed}
                  disabled={seeding}
                  style={{
                    fontSize: 11, color: "#6b6b76", background: "none",
                    border: "none", cursor: seeding ? "default" : "pointer",
                    padding: "4px 0",
                  }}
                  title="Re-add any system defaults that are missing from this scope"
                >
                  {seeding ? "Seeding..." : "Re-seed missing defaults"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddCustomForm({
  onCancel, onSubmit, isMobile,
}: {
  onCancel: () => void;
  onSubmit: (params: {
    document_type: string;
    document_category: string;
    is_required: boolean;
    scopes: DocumentScope[];
  }) => Promise<void>;
  isMobile: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("formation");
  const [required, setRequired] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<DocumentScope[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const slug = slugify(name);
  const canSubmit = slug.length > 0 && selectedScopes.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        document_type: slug,
        document_category: category,
        is_required: required,
        scopes: selectedScopes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleScope = (scope: DocumentScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <div style={{
      background: "#fafaf7", border: "1px solid #e8e6df", borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", marginBottom: 12 }}>
        New custom document requirement
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Document name
          </label>
          <input
            placeholder="e.g. Service Agreement"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #ddd9d0",
              borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          {slug && slug !== name.toLowerCase() && (
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
              Stored as: <code>{slug}</code>
            </div>
          )}
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #ddd9d0",
              borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit",
            }}
          >
            {DOCUMENT_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, color: "#1a1a1f", cursor: "pointer" }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          Apply to entity types
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DOCUMENT_SCOPES.map((scope) => {
            const selected = selectedScopes.includes(scope);
            return (
              <button
                key={scope}
                type="button"
                onClick={() => toggleScope(scope)}
                style={{
                  fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 14,
                  cursor: "pointer", border: "1px solid",
                  borderColor: selected ? "#2d5a3d" : "#ddd9d0",
                  background: selected ? "rgba(45,90,61,0.08)" : "#fff",
                  color: selected ? "#2d5a3d" : "#6b6b76",
                }}
              >
                {SCOPE_LABELS[scope]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 500, color: "#6b6b76",
            background: "#fff", border: "1px solid #ddd9d0", borderRadius: 6, cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#fff",
            background: canSubmit ? "#2d5a3d" : "#9494a0",
            border: "none", borderRadius: 6,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          {submitting ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Toggle Switch (matches compliance-rules-section)
// ───────────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked, disabled, onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 36, height: 20, borderRadius: 10, border: "none",
        background: checked ? "#2d5a3d" : "#ddd9d0",
        position: "relative", cursor: disabled ? "default" : "pointer",
        transition: "background 0.15s", flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%", background: "#fff",
          transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
        }}
      />
    </button>
  );
}
