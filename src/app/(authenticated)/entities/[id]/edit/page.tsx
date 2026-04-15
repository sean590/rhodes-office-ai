"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { US_STATES } from "@/lib/constants";
import { validateShortName } from "@/lib/utils/document-naming";
import type { EntityType } from "@/lib/types/enums";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "holding_company", label: "Holding Company" },
  { value: "investment_fund", label: "Investment Fund" },
  { value: "operating_company", label: "Operating Company" },
  { value: "real_estate", label: "Real Estate" },
  { value: "special_purpose", label: "Special Purpose" },
  { value: "management_company", label: "Management Company" },
  { value: "trust", label: "Trust" },
  { value: "person", label: "Person" },
  { value: "joint_title", label: "Joint Title" },
  { value: "other", label: "Other" },
];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9494a0",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#f0efe9",
  border: "1px solid #ddd9d0",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#1a1a1f",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none" as const,
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 28,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 80,
  resize: "vertical" as const,
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: 16,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EditEntityPage() {
  const router = useRouter();
  const params = useParams();
  const entityId = params.id as string;

  /* Form state */
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [type, setType] = useState<EntityType>("holding_company");
  const [ein, setEin] = useState("");
  const [formationState, setFormationState] = useState("");
  const [formedDate, setFormedDate] = useState("");
  const [registeredAgent, setRegisteredAgent] = useState("");
  const [address, setAddress] = useState("");
  const [parentEntityId, setParentEntityId] = useState("");
  const [notes, setNotes] = useState("");
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [aliasesInput, setAliasesInput] = useState("");
  const [ssnLast4, setSsnLast4] = useState("");

  /* Entity list for parent dropdown */
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);

  /* Loading / submission state */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Fetch existing entity data + entity list for parent dropdown */
  useEffect(() => {
    async function load() {
      try {
        const [entityRes, listRes] = await Promise.all([
          fetch(`/api/entities/${entityId}`),
          fetch("/api/entities"),
        ]);

        if (!entityRes.ok) throw new Error("Failed to load entity");

        const entity = await entityRes.json();

        setName(entity.name || "");
        setShortName(entity.short_name || "");
        setType(entity.type || "holding_company");
        setEin(entity.ein || "");
        setFormationState(entity.formation_state || "");
        setFormedDate(entity.formed_date || "");
        setRegisteredAgent(entity.registered_agent || "");
        setAddress(entity.address || "");
        setParentEntityId(entity.parent_entity_id || "");
        setNotes(entity.notes || "");
        setBusinessPurpose(entity.business_purpose || "");
        setAliasesInput(Array.isArray(entity.aliases) ? entity.aliases.join(", ") : "");
        setSsnLast4(entity.ssn_last_4 || "");

        if (listRes.ok) {
          const list = await listRes.json();
          // Exclude the current entity from the parent dropdown
          setEntities(
            list
              .filter((e: { id: string }) => e.id !== entityId)
              .map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load entity");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entityId]);

  /* Save handler */
  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!shortName.trim()) {
      setError("Short Name is required.");
      return;
    }
    const snValidation = validateShortName(shortName.trim());
    if (!snValidation.valid) {
      setError(snValidation.error!);
      return;
    }
    const isPersonOrJoint = type === "person" || type === "joint_title";
    if (!isPersonOrJoint && !formationState) {
      setError("Formation State is required.");
      return;
    }
    if (type === "person" && ssnLast4 && !/^\d{4}$/.test(ssnLast4)) {
      setError("SSN Last 4 must be exactly 4 digits.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/entities/${entityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          short_name: shortName.trim(),
          type,
          ein: ein.trim() || null,
          formation_state: formationState || null,
          formed_date: formedDate || null,
          registered_agent: registeredAgent.trim() || null,
          address: address.trim() || null,
          parent_entity_id: parentEntityId || null,
          notes: notes.trim() || null,
          business_purpose: businessPurpose.trim() || null,
          aliases: aliasesInput.split(",").map(a => a.trim()).filter(Boolean),
          ssn_last_4: ssnLast4 || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update entity");
      }

      router.push(`/entities/${entityId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f" }}>Edit Entity</div>
        <div style={{ marginTop: 24, color: "#9494a0", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  const isPerson = type === "person";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Back link */}
      <a
        href={`/entities/${entityId}`}
        onClick={(e) => {
          e.preventDefault();
          router.push(`/entities/${entityId}`);
        }}
        style={{
          fontSize: 13,
          color: "#9494a0",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        &larr; Back to Entity
      </a>

      {/* Page title */}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: "12px 0 20px" }}>
        Edit Entity
      </h1>

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(199,62,62,0.08)",
            border: "1px solid rgba(199,62,62,0.25)",
            borderRadius: 8,
            fontSize: 13,
            color: "#c73e3e",
          }}
        >
          {error}
        </div>
      )}

      <Card>
        <SectionHeader>Entity Details</SectionHeader>

        {/* Name */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entity name"
            style={inputStyle}
          />
        </div>

        {/* Short Name */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Short Name *</label>
          <input
            type="text"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder="e.g. 44H"
            maxLength={30}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
            Letters, numbers, and hyphens only. Used for document filenames. Changes only affect future uploads.
          </div>
        </div>

        {/* Type */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Type *</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EntityType)}
            style={selectStyle}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* EIN — businesses only. */}
        {!isPerson && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>EIN</label>
            <input
              type="text"
              value={ein}
              onChange={(e) => setEin(e.target.value)}
              placeholder="XX-XXXXXXX"
              style={inputStyle}
            />
          </div>
        )}

        {/* Formation State / Residence State */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>{isPerson ? "Residence State" : "Formation State *"}</label>
          <select
            value={formationState}
            onChange={(e) => setFormationState(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select a state</option>
            {US_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {isPerson && (
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
              Drives state tax filing obligations.
            </div>
          )}
        </div>

        {/* Date Formed — businesses only. People are born, not formed. */}
        {!isPerson && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Date Formed</label>
            <input
              type="date"
              value={formedDate}
              onChange={(e) => setFormedDate(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {/* Registered Agent — businesses only. */}
        {!isPerson && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Registered Agent</label>
            <input
              type="text"
              value={registeredAgent}
              onChange={(e) => setRegisteredAgent(e.target.value)}
              placeholder="Agent name"
              style={inputStyle}
            />
          </div>
        )}

        {/* Address */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address"
            style={inputStyle}
          />
        </div>

        {/* Parent Entity — businesses only. */}
        {!isPerson && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Parent Entity</label>
            <select
              value={parentEntityId}
              onChange={(e) => setParentEntityId(e.target.value)}
              style={selectStyle}
            >
              <option value="">None</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Aliases (Also Known As) — present for all entity types but most
            commonly used for persons, so the document analysis system can
            match alternate names that appear on K-1s, 1099s, etc. */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Also Known As</label>
          <input
            type="text"
            value={aliasesInput}
            onChange={(e) => setAliasesInput(e.target.value)}
            placeholder={type === "person" ? "Sean, Sean D., S. Doherty" : "DBA name, former name, etc."}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
            Comma-separated. Used by document analysis to match this entity when referenced by other names.
          </div>
        </div>

        {/* SSN Last 4 — persons only. */}
        {type === "person" && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>SSN Last 4</label>
            <input
              type="text"
              value={ssnLast4}
              onChange={(e) => setSsnLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1234"
              maxLength={4}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
              Optional. Only used to disambiguate identically-named people.
            </div>
          </div>
        )}

        {/* Notes */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            style={textareaStyle}
          />
        </div>

        {/* Business Purpose (non-trust, non-person only) */}
        {type !== "trust" && !isPerson && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Business Purpose</label>
            <textarea
              value={businessPurpose}
              onChange={(e) => setBusinessPurpose(e.target.value)}
              placeholder="Describe the business purpose of this entity..."
              style={textareaStyle}
            />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/entities/${entityId}`)}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
