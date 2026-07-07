"use client";

import { useState, useEffect, useCallback } from "react";
import { getStateLabel } from "@/lib/constants";
import { useCan } from "@/components/authz/role-provider";
import type { Jurisdiction } from "@/lib/types/enums";

interface RuleSummary {
  id: string;
  jurisdiction: string;
  entity_types: string[];
  obligation_type: string;
  name: string;
  description: string;
  frequency: string;
  filed_with: string;
}

interface OrgOverride {
  id: string;
  rule_id: string;
  action: string;
  reason: string | null;
}

interface Profile {
  id: string;
  entity_type_scope: string;
  rule_id: string;
  enabled: boolean;
  notes: string | null;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  llc: "LLC",
  corporation: "Corporation",
  lp: "LP",
  trust: "Trust",
  person: "Person",
};

const OBLIGATION_TYPE_LABELS: Record<string, string> = {
  annual_report: "Annual Report",
  franchise_tax: "Franchise Tax",
  business_license: "Business License",
  information_report: "Information Report",
  publication: "Publication",
  registered_agent: "Registered Agent",
  statement_of_info: "Statement of Information",
  estimated_fee: "Estimated Fee",
  commerce_tax: "Commerce Tax",
  business_entity_tax: "Business Entity Tax",
  other: "Other",
};

const FREQ_LABELS: Record<string, string> = {
  annual: "Annual",
  biennial: "Biennial",
  one_time: "One-time",
  continuous: "Continuous",
  decennial: "Decennial",
};

// ───────────────────────────────────────────────────────────────────
// Compliance Rules Section (Tier 1 — Org-wide overrides)
// ───────────────────────────────────────────────────────────────────

export function ComplianceRulesSection({ isMobile }: { isMobile: boolean }) {
  const canDelete = useCan("records:delete");
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [overrides, setOverrides] = useState<OrgOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterJurisdiction, setFilterJurisdiction] = useState("");
  const [filterType, setFilterType] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [rulesRes, overridesRes] = await Promise.all([
      fetch("/api/compliance/rules"),
      fetch("/api/compliance/overrides"),
    ]);
    if (rulesRes.ok) setRules(await rulesRes.json());
    if (overridesRes.ok) setOverrides(await overridesRes.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rulesRes, overridesRes] = await Promise.all([
        fetch("/api/compliance/rules"),
        fetch("/api/compliance/overrides"),
      ]);
      if (cancelled) return;
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (overridesRes.ok) setOverrides(await overridesRes.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const disabledSet = new Set(
    overrides.filter((o) => o.action === "disable").map((o) => o.rule_id),
  );

  const jurisdictions = [...new Set(rules.map((r) => r.jurisdiction))].sort();
  const obligationTypes = [...new Set(rules.map((r) => r.obligation_type))].sort();

  const filtered = rules.filter((r) => {
    if (filterJurisdiction && r.jurisdiction !== filterJurisdiction) return false;
    if (filterType && r.obligation_type !== filterType) return false;
    return true;
  });

  const grouped = new Map<string, RuleSummary[]>();
  for (const r of filtered) {
    const key = r.jurisdiction;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const toggleRule = async (ruleId: string, currentlyDisabled: boolean) => {
    setSaving(ruleId);
    if (currentlyDisabled) {
      await fetch(`/api/compliance/overrides?rule_id=${ruleId}`, { method: "DELETE" });
    } else {
      await fetch("/api/compliance/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, action: "disable" }),
      });
    }
    await refresh();
    setSaving(null);
  };

  if (loading) {
    return <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading compliance rules...</div>;
  }

  const disabledCount = disabledSet.size;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 16px 0" }}>
        Disable rules org-wide to prevent obligations from generating for any entity.
        {disabledCount > 0 && (
          <span style={{ marginLeft: 8, color: "#c47520", fontWeight: 500 }}>
            {disabledCount} rule{disabledCount !== 1 ? "s" : ""} disabled
          </span>
        )}
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={filterJurisdiction}
          onChange={(e) => setFilterJurisdiction(e.target.value)}
          style={{
            padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd9d0",
            fontSize: 13, background: "#fff", color: "#1a1a1f",
          }}
        >
          <option value="">All Jurisdictions ({jurisdictions.length})</option>
          {jurisdictions.map((j) => (
            <option key={j} value={j}>{getStateLabel(j as Jurisdiction)}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{
            padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd9d0",
            fontSize: 13, background: "#fff", color: "#1a1a1f",
          }}
        >
          <option value="">All Types</option>
          {obligationTypes.map((t) => (
            <option key={t} value={t}>{OBLIGATION_TYPE_LABELS[t] || t}</option>
          ))}
        </select>
      </div>

      {/* Rules grouped by jurisdiction */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {[...grouped.entries()].map(([jurisdiction, jRules]) => (
          <JurisdictionGroup
            key={jurisdiction}
            jurisdiction={jurisdiction}
            rules={jRules}
            disabledSet={disabledSet}
            saving={saving}
            onToggle={toggleRule}
            canDelete={canDelete}
            isMobile={isMobile}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
          No rules match the current filters.
        </div>
      )}
    </div>
  );
}

function JurisdictionGroup({
  jurisdiction, rules, disabledSet, saving, onToggle, canDelete, isMobile,
}: {
  jurisdiction: string;
  rules: RuleSummary[];
  disabledSet: Set<string>;
  saving: string | null;
  onToggle: (ruleId: string, disabled: boolean) => void;
  canDelete: boolean;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const disabledInGroup = rules.filter((r) => disabledSet.has(r.id)).length;

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
          {getStateLabel(jurisdiction as Jurisdiction)}
        </span>
        <span style={{ color: "#9494a0", fontSize: 12 }}>
          {rules.length} rule{rules.length !== 1 ? "s" : ""}
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
          {rules.map((rule) => {
            const isDisabled = disabledSet.has(rule.id);
            const isSaving = saving === rule.id;
            return (
              <div
                key={rule.id}
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
                    {rule.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>
                    {rule.description.length > 120 ? rule.description.slice(0, 120) + "..." : rule.description}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                    color: "#6b6b76", background: "rgba(107,107,118,0.08)",
                  }}>
                    {OBLIGATION_TYPE_LABELS[rule.obligation_type] || rule.obligation_type}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                    color: "#6b6b76", background: "rgba(107,107,118,0.08)",
                  }}>
                    {FREQ_LABELS[rule.frequency] || rule.frequency}
                  </span>
                  <span style={{
                    fontSize: 10, padding: "1px 6px", borderRadius: 4,
                    color: "#9494a0", background: "rgba(107,107,118,0.05)",
                  }}>
                    {rule.entity_types.join(", ")}
                  </span>
                  <ToggleSwitch
                    checked={!isDisabled}
                    disabled={isSaving || !canDelete}
                    onChange={() => onToggle(rule.id, isDisabled)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Compliance Profiles Section (Tier 2 — Per-entity-type)
// ───────────────────────────────────────────────────────────────────

export function ComplianceProfilesSection({ isMobile }: { isMobile: boolean }) {
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overrides, setOverrides] = useState<OrgOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [rulesRes, profilesRes, overridesRes] = await Promise.all([
      fetch("/api/compliance/rules"),
      fetch("/api/compliance/profiles"),
      fetch("/api/compliance/overrides"),
    ]);
    if (rulesRes.ok) setRules(await rulesRes.json());
    if (profilesRes.ok) setProfiles(await profilesRes.json());
    if (overridesRes.ok) setOverrides(await overridesRes.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rulesRes, profilesRes, overridesRes] = await Promise.all([
        fetch("/api/compliance/rules"),
        fetch("/api/compliance/profiles"),
        fetch("/api/compliance/overrides"),
      ]);
      if (cancelled) return;
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (profilesRes.ok) setProfiles(await profilesRes.json());
      if (overridesRes.ok) setOverrides(await overridesRes.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const orgDisabledSet = new Set(
    overrides.filter((o) => o.action === "disable").map((o) => o.rule_id),
  );

  const profileMap = new Map<string, Profile>();
  for (const p of profiles) profileMap.set(`${p.entity_type_scope}|${p.rule_id}`, p);

  const seedScope = async (scope: string) => {
    setSeeding(scope);
    await fetch("/api/compliance/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type_scope: scope }),
    });
    await refresh();
    setSeeding(null);
  };

  const toggleProfile = async (scope: string, ruleId: string, currentEnabled: boolean) => {
    const key = `${scope}|${ruleId}`;
    setSaving(key);
    await fetch("/api/compliance/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type_scope: scope, rule_id: ruleId, enabled: !currentEnabled }),
    });
    await refresh();
    setSaving(null);
  };

  if (loading) {
    return <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading compliance profiles...</div>;
  }

  const scopes = ["llc", "corporation", "lp", "trust", "person"] as const;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 16px 0" }}>
        Control which rules apply to each entity type. Rules disabled org-wide (above) are shown grayed out.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {scopes.map((scope) => {
          const scopeRules = rules.filter((r) =>
            r.entity_types.includes("all") || r.entity_types.includes(scope),
          );
          const scopeProfiles = profiles.filter((p) => p.entity_type_scope === scope);
          const hasProfiles = scopeProfiles.length > 0;

          return (
            <EntityTypeProfileGroup
              key={scope}
              scope={scope}
              rules={scopeRules}
              profileMap={profileMap}
              orgDisabledSet={orgDisabledSet}
              hasProfiles={hasProfiles}
              seeding={seeding === scope}
              saving={saving}
              onSeed={() => seedScope(scope)}
              onToggle={toggleProfile}
              isMobile={isMobile}
            />
          );
        })}
      </div>
    </div>
  );
}

function EntityTypeProfileGroup({
  scope, rules, profileMap, orgDisabledSet, hasProfiles,
  seeding, saving, onSeed, onToggle, isMobile,
}: {
  scope: string;
  rules: RuleSummary[];
  profileMap: Map<string, Profile>;
  orgDisabledSet: Set<string>;
  hasProfiles: boolean;
  seeding: boolean;
  saving: string | null;
  onSeed: () => void;
  onToggle: (scope: string, ruleId: string, enabled: boolean) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);

  const disabledCount = rules.filter((r) => {
    if (orgDisabledSet.has(r.id)) return true;
    const p = profileMap.get(`${scope}|${r.id}`);
    return p && !p.enabled;
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
          {ENTITY_TYPE_LABELS[scope] || scope}
        </span>
        <span style={{ color: "#9494a0", fontSize: 12 }}>
          {rules.length} rule{rules.length !== 1 ? "s" : ""}
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
          {!hasProfiles ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#6b6b76", margin: "0 0 12px 0" }}>
                No profiles configured yet. Seed from the rules engine to get started.
              </p>
              <button
                onClick={onSeed}
                disabled={seeding}
                style={{
                  padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                  background: "#2d5a3d", color: "#fff", border: "none", cursor: "pointer",
                  opacity: seeding ? 0.6 : 1,
                }}
              >
                {seeding ? "Seeding..." : `Initialize ${ENTITY_TYPE_LABELS[scope]} Profiles`}
              </button>
            </div>
          ) : (
            rules.map((rule) => {
              const key = `${scope}|${rule.id}`;
              const profile = profileMap.get(key);
              const isOrgDisabled = orgDisabledSet.has(rule.id);
              const isEnabled = isOrgDisabled ? false : (profile?.enabled ?? true);
              const isSaving = saving === key;

              return (
                <div
                  key={rule.id}
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
                      {rule.name}
                      {isOrgDisabled && (
                        <span style={{
                          marginLeft: 8, fontSize: 10, color: "#c47520", fontWeight: 500,
                        }}>
                          disabled org-wide
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>
                      {getStateLabel(rule.jurisdiction as Jurisdiction)} · {OBLIGATION_TYPE_LABELS[rule.obligation_type] || rule.obligation_type} · {FREQ_LABELS[rule.frequency] || rule.frequency}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={isEnabled}
                    disabled={isSaving || isOrgDisabled}
                    onChange={() => onToggle(scope, rule.id, isEnabled)}
                  />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Toggle Switch
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
